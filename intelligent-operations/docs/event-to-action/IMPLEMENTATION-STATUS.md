# TriageNorth implementation status

Updated 21 October 2026. This is the record of delivered behavior; the proposal and diagrams describe the target.

## Current supervised runtime and delivery

The operator restarted Docker on 21 October and explicitly resumed development.
The native Kubernetes portal is available at http://127.0.0.1:38081. The existing
development kernel is source 65ed1926cdbd, with the separate account runtime at 782ae3d.
Public application changes are installed through its
source-trust, preview, consent and current-user authorization flow. TriageNorth is
the product name; the stable runtime package remains `intelligent-operations`.
The overnight heartbeat remains paused.

The Operations nodes now have explicit 3/8/5-GiB ceilings, two CPUs each and no swap.
The redundant GitOps lab and superseded standalone Operations deployments are
stopped. Shared workspace/editor/worker placement passes the existing capacity
check, with a point-in-time host reserve; this is not a production capacity profile.
No GPU workload was started. The operator identified the separate training program
as the cause of the earlier incident. Historical resource observations remain in
[RESOURCE-REVIEW.md](RESOURCE-REVIEW.md); its old shutdown restriction is superseded.

Earlier application baseline `3c557c4a` adds server-verified saved replay cohorts on top of the accepted
`a3d8d4a5` scenario/standard-stream/bank-growth increment. Final revision-specific
native acceptance is recorded below and in `deploy/evidence/replay.json`. All 83
Operations package tests pass, with no skips. The normal full Store gate reports
83 passing checks, zero failures, six partial suites and twelve explicitly unavailable
prerequisites; partial/skipped work is not certified. All completed source checkpoints
are published through normal hooks; the current experience delivery branch is
`origin/codex/triagenorth-live-operations`.

[DELIVERY-AUDIT.md](DELIVERY-AUDIT.md) retains the full completion scope. This increment
proves context intake, retention and explainable replay. Continuous delegated producer
admission, trained/calibrated anomaly detection, automatic ticket/workflow linkage,
workflow-generated remediation and verified execution, provider synchronization and
live cloud discovery remain open. See [EXPORT-STATUS.md](EXPORT-STATUS.md) for current
PowerPoint, Word, PDF and editable Visio artifacts.

## Systems source increment

Commit `1e7141f1` adds the [Systems experience](SYSTEMS.md) over the existing
caller-scoped graph and event reads. It filters observed resources by system,
namespace, type, health and search; shows captured facts, placement/ownership and
exact related alerts; links to the original topology asset and event inspector.
The existing estate toolbar identity now opens Systems. No new collector,
credential, command executor or authorization path is introduced (ADR0019).

Twelve focused tests pass, including native-identity ambiguity, historical event
boundaries, partial/unknown state, bounded cards, safe text rendering and the
shipped controller's access-refusal/late-response clearing. JavaScript syntax,
unique HTML IDs, YAML manifest and Test Lab registration also pass. These checks
used the authorized CPU-only resource scope. The Systems source is now included in the installed and published package. Its
focused checks and the normal package gate pass. The later Scenario lab/Live context
browser receipt does not substitute for a separate live two-user Systems acceptance.

## Three-week evaluation preparation

The operator requested dataset-based percolation/anomaly testing, cheaper local
analysis and a more compelling demonstration over three weeks. THREE-WEEK-PLAN.md
and ADR0018 record the work and acceptance criteria. The prepared NAB pilot contains
30,146 observations in four series, plus label windows, description and license;
all seven files total 923,051 bytes in a separate local cache. evaluation-data.json
pins upstream revision, hashes, row counts and timestamp-quality observations.
Eleven adjacent repeated timestamps in the EC2 series remain intact. Preparation
ran under 25%-of-one-core and 256-MiB limits; peak scope memory was about 15.1 MiB.
This initial preparation did not run a detector, percolator or model benchmark.
The later BGL percolation baseline and Scenario lab acceptance are recorded below;
NAB detector evaluation and a complete product end-to-end acceptance remain open.

## Kernel baseline editor

Code Server is now included in the native kernel Kubernetes baseline, before public
applications. The existing installation was upgraded; the portal opens its actual
workflow-generated `answer.md` on the shared PVC. Fresh baseline login/readiness and
byte equality across kernel/editor are independently checked. The editor listener is
bound to pod loopback, because the local kind CNI does not enforce NetworkPolicy.
It receives neither kernel credentials nor a Kubernetes service-account token.
This is a local operator editor with access to the full share; remote multi-user
scoping is a separate gate. See ADR0015 and kernel `deploy/k8s/editor-evidence.json`.

## Standard workspace correction

The native installer now restores the existing Helm `oshal-workspace` claim and
`/app/workspace-shared` mount (kernel commits `a3de02d`, `18b68cd`). The local kernel
and enrolled Operations worker both mount it. Actual checks proved kernel-to-worker
file visibility and persistence after worker pod replacement; the installation probe
was then removed. The worker's NetworkPolicy blocked a direct PostgreSQL connection.
A fresh synthetic installer ticket completed investigate, review and revise through
the Kubernetes worker. These checks do not establish generated remediation scripts.

The previous pressure drill supplied scripts as inputs. That is not workflow-generated
remediation. The old portal also used a hard-coded host workspace path and hid write
errors. Kernel `aac99fb` implements runtime artifact persistence, authenticated downloads,
historical-result access and the native approval UI correction. Source checks pass:
24 workspace tests, 280 API tests, 10 actual-worker/workflow cases (the expiry fixture
uses a 90-second window on this loaded host), four focused browser-model tests and
strict library linting. Kubernetes rollout and experience acceptance are tracked
separately; do not infer those outcomes from the PVC mount alone. See ADR0011.

## Fresh Kubernetes installation and satellite portal

The native kernel installer is committed as `oshal-kernel` `6eec292`, with password bootstrap
in runtime `369d96f`. A fresh `oshal-install-lab` namespace starts PostgreSQL, initializes the
administrator password before serving, removes its one-use password Secret, and starts the
kernel before staging public `intelligent-operations` source `59f48a06`. No private applications
are loaded. Built-in Jarvis and Workflow Studio are present before store packages.

Actual acceptance passed password/wrong-password behavior, native administrator sessions,
short-lived enrollment-code minting, unassigned refusal, composite role preview/apply, the
installed Operations experience at desktop/phone widths, and logout. Password, application
role and saved source records survived kernel pod replacement. The already installed OSHAL
Node 0.5.2 also signed in and out through its actual portal window in a separate Kubernetes
profile; the original bare-metal desktop configuration was unchanged.

**Codex and Claude transfer now work.** Kernel `41538eb` added the native receiving
boundary and private account runtime. Five checks through the actual packaged Linux desktop
proved password login, both real transfer buttons, a real model response inside Kubernetes,
credential-free local transfer logs and refusal after logout. Desktop `6c42c27b` is merged
through PR1138 and installed with the isolated native profile. The earlier authenticated 404
was a missing native route, not Windows-only credential handling. Antigravity is not certified;
cloud CLI login remains local to the satellite.

The public source was explicitly trusted before installing Operations 1.1.0, AI Office
2.13.3 (`presentations`) and Intelligent Communication 1.4.7 (`email-summarizer`) from
committed snapshot `fa2e557b`. Built-in Jarvis and Workflow Studio complete the five active
packages. Finance and private packages are excluded. Operations operator and Jarvis chat-user
assignments are active; Office and Communication use existing admin application tiers.
Codex is selected explicitly with Claude fallback. A real Office assistant request produced
a valid PowerPoint file. The admin experience now contains two actual historical lab captures
and six validated firing/resolved observations, with original timestamps preserved.

Kernel `f365321` implements Telegram delivery through the shared notification rail and adds
private post-baseline connector configuration. Three transport tests, seven notification/API
tests, fifteen installer tests and strict library linting pass. The existing Telegram bot and
private destination pass read-only provider validation. Mailbox OAuth login, real Telegram
send acknowledgement and automatic Operations notification production remain distinct gates;
configuration is not evidence of external message delivery. See ADR0006.

Kernel evidence and commands: `deploy/k8s/LOCAL-INSTALL.md` and
`deploy/k8s/local-install-evidence.json`. Source checks: fifteen installer, six deployment-template
and 21 CI-discovery contracts; runtime password tests remain separately recorded. Full kernel
CI and production Kubernetes publication are not certified by the local installation.

| Area | State | Evidence or remaining work |
|---|---|---|
| Problem statement and architecture | Delivered | Proposal in Markdown, Word and PDF; fourteen-page editable Visio plus PDF/SVG previews. Independent import preserves all diagram text. |
| Project plan and dependencies | Delivered | PROJECT-PLAN.md defines milestone gates, dependencies, test data and the documentation contract. |
| Application foundation M1 | Deployed and browser-verified | Native experience launcher, real OSHAL login, reader/operator roles, durable person-scoped records and preserved incident specialists. |
| Local Kubernetes lab L1 | Resumed; current context/replay accepted | Separate `operations-lab` cluster: one control plane and two workers, native portal/worker/editor/database and monitoring. Startup/placement checks pass with explicit local node caps. Earlier pressure acceptance is historical; no new saturation drill is claimed. |
| Interactive UX prototype | Implemented separately | Eight connected synthetic screens; desktop/phone browser checks cover partial evidence, unknown health, identity quarantine, viewer refusal, changed-revision approval invalidation and download hashes. No service calls or installed approval claims. |
| Adapter mapping preparation | Deployed | Explicit JSON Pointer mappings for seven fields saved as immutable source revisions. Browser preview remains available separately. |
| Source registration and durable intake M2 | Partial, deployed | Authenticated operator imports, saved mapping revisions, raw/normalized records, validation/quarantine and exact-payload retry reuse. Transactional delivery ledger, conflict quarantine and concurrent admission now verified; background source identity remains. |
| Inventory and topology M3 | Partial, deployed | Historical actual Kubernetes pod UIDs, placement, container readiness and fault/recovery captures. Native temporal scan journal, graph display and bounded manual correlation now verified. Scheduled discovery and cloud-provider acceptance remain. |
| Detection and correlation M4 | Partial; prior native acceptance | Real percolation/reduction, bounded manual correlation and scheduled queue processing have native receipts; the current Operations source run passes 83 tests. Separate bounded telemetry/window storage and native replay are now accepted. Continuous automatic correlation, detector and downstream consumers remain. |
| Evidence and investigation M5 | Partial, live lab verified | Actual bounded CPU alert, isolated hashed packet, canonical ticket and three real model phases reach human report acceptance. Automatic conditional capture remains. |
| External ticket synchronization M5b | Planned | Standard ServiceNow/GitHub/GitLab/Jira connectors and current-caller connections; shared write/webhook gaps, field ownership, operation ledger and live-provider acceptance remain required. |
| Deliverables and bound approval M6 | Planned | Exact artifact/target binding must be verified against native shared services. |
| Execution and recovery M7 | Planned | Registered action and explicit principal/policy; no unattended infrastructure changes enabled. |
| Installed acceptance | Passed for first increment | Real native sessions/roles, person isolation, revocation, source/event forms, actual Kubernetes captures, desktop/phone UI and persistence through pod replacement. See revision-specific evidence below. |

## Pressure-to-investigation acceptance — 20 October 2026

Store `24f965be` adds measured CPU pressure, read-only evidence capture and native dispatch.
The owned worker ran a bounded one-CPU Job; Prometheus observed process CPU use above 0.45 cores
for ten seconds. Alertmanager delivered firing and resolved states for the same episode and
fingerprint. The pressure Job is absent and all three nodes are Ready. This is not proof of
whole-node saturation or Kubernetes MemoryPressure/DiskPressure.

The namespace collector passed actual denials for Secrets, pod exec, deployment mutation and
cross-namespace pod reads. Its temporary credentials were deleted. The investigation worker received
only five digest-bound projected evidence/proposal files, without Kubernetes credentials or tools.

First ticket `a6cd2473-6068-409b-aaf7-024ac7674af4` failed because the protected worker still used
its boot-time `noop` default even though the portal's effective fleet settings selected Codex.
The local deployment now explicitly sets `OSHAL_INFERENCE_API=codex-account` and
`OSHAL_INFERENCE_MODEL=gpt-6.1-sol`. Dynamic fleet-setting parity for protected workers remains a
kernel issue; this configuration correction does not claim that bug is fixed in core.

The retry recorded in the private lab receipts, `bf6c1a31-f0b6-4a53-b13a-f15b0654ff66`, completed investigate, review and revise
using real model requests, then stopped at the published human report-acceptance gate. This is
not infrastructure execution approval. The model accurately reports that its original packet has
no recovery evidence; the operator subsequently verified recovery separately. `lab/pressure_verify.py`
rechecks actual deliveries, node readiness, Job absence, collector denials and all three worker outputs.
Two actual pressure observations were imported into the signed-in Data view, retaining timestamps,
packet digest and canonical ticket reference. Automatic intake/reduction was not involved.

Operations 1.1.1 is installed from committed source `b8f1df53`, artifact
`c2a8b4c180ae0e7b1d6fb02056fdaa11b364d6ec07c161d9e1345c5d8533ac07`.
The incident experience lists only Operations/Processing tickets returned by the native caller
session, then opens each canonical ticket directly. Browser acceptance covered the installed link
and Workflow tab. Kernel UI commit `8161399` handles the native workflow read model rather than
requiring the legacy response shape; the local platform-only image is `oshal-kernel:8161399-ui`.
It retains the `f365321` Rust binary. Three real-renderer contracts and 28 Operations checks pass.

Source-bound output withholding after a package upgrade is preserved: old ticket results may become
unavailable in the current read model. The verifier refuses null/withheld outputs. Original receipts
remain private; fresh current-source acceptance is recorded in `deploy/evidence/pressure-workflow.json`.
Final current-source ticket `e4255337-57c1-4979-b5a3-209981fbe106` passed live verification of all
three nonempty model results and the human gate, with matching alert resolution and isolation
denials. Report acceptance remains pending. No infrastructure action or external ticket synchronization ran.

The reviewed source process and missing services are itemized in PIPELINE-REVIEW.md and ADR0007.
Stored-query filtering, distributed reduction, temporal correlation and an anomaly engine remain
undelivered. Monitoring installation and this manual vertical slice do not replace those gates.

## Release checks

The normal Store push through `5fbe9f39` succeeded on 20 October 2026: **82 passed,
0 failed, 6 partial, 12 skipped, 0 blocked**. Disposable PostgreSQL, pinned Publishing
Python/Typst, the original Typst archive and wheel cache were supplied. The documented
`OSHAL_STORE_CI_ALLOW_SKIPS=1` mode accepted explicitly reported legacy-source, Career
runtime and simulation prerequisites; those skipped cases are not passing evidence.
Calendar fixture teardown was corrected to drain connections before ordinary database removal,
with a real PostgreSQL regression; all five Calendar checks pass. Earlier transient teardown failures
and an incorrect local Publishing fixture path blocked pushes and were corrected before this result.
No hook was disabled. Operations source and design commits are now published on
`origin/feat/native-application-executors`; package audit and full kernel certification
remain separate. Earlier attempts below are historical.

The design package is committed as `1affc000`. Its normal push was refused by the enabled pre-push gate: 80 passed, 2 failed, 6 partial and 12 skipped. Calendar needed disposable PostgreSQL and Publishing needed its pinned renderer runtime. These are not passing results. Record new build evidence here as each milestone completes.

The plan and dependency register are committed as `f1fcc503`. Foundation contracts cover package declarations, local alert validation, ticket projection, the actual desktop/phone browser, old-response suppression after access refusal, lab ownership/resource limits, and captured-data hashes. Store catalog and test discovery checks pass. The existing full-gate prerequisites remain required for publication; installed native and live-provider acceptance are separate work.

The foundation is committed as `1b286b47`. All 17 focused Operations tests pass with no skips;
the catalog/local-gate contract run also passed its 13 tests. The 1.1.0 package audit remains pending.
Source publication, audit acceptance and installed browser acceptance are separate gates; no audit
approval or installed-source acceptance is implied by the local browser fixture results.

The normal foundation push to `origin/feat/native-application-executors` was refused by the
enabled repository hook: 80 passed, 2 failed, 6 partial and 12 skipped. Calendar requires a
disposable PostgreSQL fixture; Publishing requires its pinned Python renderer runtime.
Legacy prerequisites and partial suites remain named by the gate. The Operations suites
inside the runnable-package step passed. No hook was bypassed; source commits remained local at that attempt, before the successful publication above.

## Local lab evidence

The successful local run began at `2026-10-20T17:28:05Z` and finished at `2026-10-20T17:30:35Z`.
It observed successful dependency requests, real synthetic error rates and firing alerts, recorded a new webhook, captured pod/event/log evidence, verified HTTP 200 recovery and alert clearing, then observed a distinct pod UID during scale-out. Cleanup restored healthy configuration, two API replicas and no remaining load Jobs.

[Sample acceptance receipt](../../lab/samples/acceptance.json) and [lab instructions](../../lab/README.md)
retain provenance. The firing and resolved examples share three actual alert occurrences by fingerprint
and start time. Data comes from a synthetic local environment, not production monitoring or OSHAL ingestion.
OTLP request spans were received by the local collector; it currently debug-exports rather than providing
a durable trace backend. Readiness and crash fault modes are available but were not certified by this
particular real-cluster acceptance run.

The lab tools enforce its own private kubeconfig, loopback API and stored cluster UID before changes.
The existing GitOps cluster and OSHAL runtime are outside its mutation scope. The cluster remains
running in healthy mode for development. `lab.py recover` restores baseline; `lab.py destroy` removes it.

## Next gate

Complete M2 background source authentication, retained delivery attempts and concurrent admission before
claiming automated ingestion. Authenticated manual imports and historical inventory now work in the
installed experience. Continuous discovery, graph correlation, production reduction, packet assembly,
bound approvals and infrastructure execution remain planned; no automatic remediation was activated.

## UX-to-build increment

The separate prototype is committed as `7711710f`. It is served locally at
`prototype/index.html` and never calls an API. Browser checks exercise evidence retry, unknown node
telemetry, historical snapshots, missing/ambiguous identity, viewer refusal, revision invalidation,
manifest download/hash agreement and all screens at 1440, 390 and 320 pixels.

The next source increment implements adapter mapping in the real Source preview, preserving the
live ticket read boundary. All 20 focused Operations tests pass without skips. These results certify
local source and fixture browser behavior, not installed authentication, durable ingestion, native
approval or remediation. The package remains the pending 1.1.0 source release.

The topology and connection UX increment adds five synthetic estate scopes (Kubernetes, AWS, Azure,
GCP and data center), typed edges, scoped identity/source inspection, filters and draft scan intervals.
Connections & CLI distinguishes operator login from unattended identities and tests authentication,
inventory and evidence separately. Missing-tool, wrong-scope, expired-session, viewer and revoke
states are browser-verified. These are mock service outcomes, not real provider or CLI sessions.
See CONNECTIONS-AND-TOPOLOGY.md for the required native and provider acceptance.

## Experience-slice design revision

The proposal, plan, problem statement and their Word/PDF exports now cover the OSHAL experience
boundary, single user login, standard inbound/outbound connections, inspectable data decisions and
external ticket synchronization. The Visio contains 11 pages, 573 editable shapes and 33 glued
connectors, including new data, integration and connection-identity pages. DECISIONS.md and four
accepted-design ADRs record rationale, owner boundaries and acceptance; operations-decisions.pdf
and .docx export the log and full records. Design acceptance does not establish implementation.
The new data/sync prototype is still a local demonstration increment, separate from production
reduction, durable sync and installed native services.

## Functional UX increment after the design revision

The local prototype now includes Data & decisions and Ticket synchronization. A deterministic replay
separates delivery retries, symptom updates, severity filtering, missing-identity quarantine and
scope refusal; telemetry remains a separate view. The production noise algorithm, percolation,
durable reservation and concurrent/restart semantics are not implemented by this demonstrator.

The synchronization preview uses the current-caller framework model for all four target providers,
shows their reviewed declaration gaps, and exercises confirmed preview, field direction, viewer
refusal, expired/denied/conflicting outcomes and reconciliation before retrying an uncertain create.
The create/link operation identity survives policy-direction changes. No external ticket is sent.
All eight screens are checked at 320, 390 and 1440 pixels, with keyboard navigation and sensitive
fixture withholding. All 21 focused Operations tests pass without skips. Live M2/M4/M5b acceptance,
provider operations, installed grants and guarded connector calls remain build work.

## Kubernetes experience build — 20 October 2026

The application now declares a native Operations experience at
`/api/ui/experiences/intelligent-operations/open`, with native `reader` and `operator` roles.
Its authenticated package routes persist source revisions, original/normalized alert records and
Kubernetes inventory captures through the kernel's person-scoped store. The experience renders
record provenance and historical pod/node/container placement. This is the first persisted slice;
continuous collection, the established reduction algorithm, OTLP storage, ticket synchronization
and execution remain planned. Existing specialist identities are preserved.

The [deployment procedure](../../deploy/README.md) builds the committed application into a pinned
native runtime and deploys it into the owned local Kubernetes lab with independent PostgreSQL and
persistent volumes. Installed browser acceptance passed with real native login, role isolation, source/event forms,
quarantine, actual inventory, desktop/phone layouts, revocation and pod replacement persistence. No production users or grants
are changed by this isolated deployment.

### Measured installed evidence

The native deployment uses the owned `operations-lab` cluster and `operations-experience` namespace,
with separate kernel/PostgreSQL deployments and persistent volumes. The package image is built from
committed application source; the native kernel is pinned at `47cbad1` without core changes.
[Sanitized receipts](../../deploy/evidence/installed-acceptance.json) identify tested revisions and times.
Private tokens and screenshots stay in the local state directory described by the deployment guide.

The lab fault/recovery run produced actual firing and resolved Alertmanager deliveries. Six records
were imported through the authenticated app boundary and inspected in the experience with exact
pod UIDs and capture receipt hashes. The fault and recovery inventory showed different actual UIDs.
These are real observations of synthetic local workloads. Readiness is explicitly historical;
unknown conditions are preserved. No continuous webhook, cloud scan, incident reduction or external
ticket write is claimed by this acceptance.

Current source checks: 25 passed, zero failed or skipped. Installed acceptance includes the actual
experience launcher and native login, signed-out/unassigned refusal, read-only mutation refusal,
person isolation, role downgrade/revocation, responsive topology and persisted event inspection.
The compiled route is exercised under Express as well as the installed native sandbox.

Publication is subject to the enabled repository-wide pre-push gate and the pending 1.1.1
package audit. Operations acceptance does not substitute for those gates. The latest push result
is recorded in [the delivery receipt](../../deploy/evidence/delivery.json): 82 passed, zero failed,
6 partial and 12 skipped after supplying disposable PostgreSQL and the genuine Publishing runtime; no hook or missing prerequisite is bypassed.

## Transactional intake increment — source acceptance

New authenticated manual imports use the package's scoped SQL transaction service. One commit
stores the original delivery, its attempt and (only for valid input) a pending processing item.
The delivery key is the registered source URI plus event ID, scoped to the caller. Canonical JSON
hashing makes object-key order immaterial while preserving array order and values. Reusing that
identity with changed content returns HTTP 409, retains the conflicting raw payload in the attempt
ledger, and leaves the original untouched. Missing identity, source mismatch and environment
mismatch remain inspectable quarantine without processing admission. Historical document-store
imports remain visible with an explicit historical marker; they are not retroactively certified.

The Data inspector now shows returned delivery attempts, their outcomes and conflicting payloads.
The list is bounded to the latest 200 attempts, so its displayed count is explicitly a page count.
Six real PostgreSQL/browser acceptance cases exercise 100 concurrent reordered retries through
two independent pools, restart via a replacement pool, independent source/ID identity, conflicting
content, quarantine, forced owner isolation, rollback after partial writes, and a lost response after
COMMIT followed by producer retry. All 34 Operations cases pass with no skips. Hosted CI provisions
a disposable PostgreSQL service and runs every Operations CJS suite rather than a fixed file list.

This increment does not activate a background producer, filtering or symptom suppression. The
pending processing table is the durable handoff for those next stages. Native Kubernetes migration
and installed admission acceptance are still required before calling P1 delivered; PostgreSQL
acceptance is not evidence that the native SQL implementation behaves identically.

Native installation follow-up: committed source `2ce0a5c9` was previewed and installed through
App Loader in `operations-lab/oshal-install-lab`, including its native table migration. A real
portal run sent 100 requests from four concurrent HTTP clients: one created delivery, 99 retries,
101 retained attempts after a conflicting submission, HTTP 409 preserving both payloads, a
quarantined missing-identity record and HTTP 401 without a session. The actual browser inspector
showed that history. This was one native kernel deployment, not a two-kernel-replica claim.
The next source increment exposes pending processing state and adds a repeatable
`python3 intelligent-operations/lab/intake_verify.py` acceptance command. The first normal push
was refused because the browser test resolved its toolchain relative to the working directory;
that dependency path is corrected, and all 34 cases also pass from the package directory.

Source `0ce3461a` is now installed and the repeatable native acceptance passes, including exactly
one pending processing item for 100 concurrent requests and no processing item for quarantine.
The sanitized receipt is `deploy/evidence/intake.json`. The broader background-source, two-kernel
replica, retention and replay-lineage gates remain open; the PostgreSQL test uses two independent
pools and must not be presented as a two-kernel deployment test.
The same receipt now also proves persistence through an actual native kernel pod replacement:
a post-restart retry raised its attempt count to 102 while retaining the original delivery and
exactly one pending processing item. The original browser session still opened Data & decisions.

## Temporal graph increment — source implementation

ADR0009 implements the reviewed graph structure with two scoped SQL tables: immutable scan
history and correlation decisions. The Estate experience reconstructs a selected timestamp and
collection, displays directed relationships, and exposes native IDs, health timestamps and source
observations. The Data view can correlate selected validated firing deliveries and inspect the
exact saved policy, graph revision and paths. This is manual correlation, without ticket dispatch.

The guarded `lab/topology.py --output <file>` loader captures the owned Kubernetes namespace
using native UIDs, actual owner-reference chains, container runtime IDs and EndpointSlices.
An initial live capture observed 18 assets and 32 relationships; it is not evidence of a periodic
scanner. Complete scans retire missing observations only within their source collection; partial
scans preserve them without refreshing their timestamps. Source/SQL/browser tests cover retries,
conflicts, owner isolation, late scans, historical reconstruction, pod replacement, partial failure,
common hubs, stale/unresolved relationships, traversal limits and saved decision replay.

Limits are explicit: 64 KiB per scan, 256 assets / 512 edges per scan, 200 scans per reconstruction,
2,000 assets / 5,000 edges per graph, at most 200 correlated deliveries. There is no retention or
checkpoint implementation yet. Larger history fails closed. Conflicting source observations need
further resolution policy. Scheduled least-privilege collection, cloud scanners, suppression-stage
integration and automatic event-time selection remain open P4 work. Native deployment acceptance
is recorded separately after installation; source tests do not imply it passed.

Native follow-up: source `a0066a4b` is installed with artifact
`ba6c67396b1121e6b094ad970c7e6de758b6f758653ed90a426a049b1427f61d`.
The kernel invalidated the prior Operations assignment on the changed route contract; the existing
admin operator assignment was previewed and re-approved through native composites, retaining
the same own-scope grants. `lab/topology_verify.py` then passed against the installed package:
18 actual assets, 32 relationships, idempotent scan retry, changed-content HTTP 409, anonymous
HTTP 401, and repeatable saved correlation. Three explicitly synthetic acceptance alerts formed
two groups through one observed container-to-pod path. Real portal clicks independently showed
the graph and saved a two-group correlation decision. The sanitized receipt is
[deploy/evidence/topology.json](../../deploy/evidence/topology.json). All 41 Operations tests pass;
the normal repository push gate reports 83 passed, zero failed, 6 partial and 12 explicitly skipped.
The outstanding periodic discovery and full pipeline gates above remain unchanged.

## Percolation and transactional suppression source acceptance

The package now publishes immutable OpenSearch rule generations through the existing native
engine relay and activates a source binding only after all rules are sealed. The Data view
provides policy publication, service health, selected-event evaluation and durable decision records.
The caller-scoped transaction records rule matches, symptom counts, replay lineage and unique
evidence reservations. Fixed/sliding windows and escalation thresholds are explicit.

All 51 package cases pass without skips, including 10 new detection cases against real PostgreSQL,
real OpenSearch 3.3.2 and actual browser assets. One hundred distinct occurrences across two
independent SQL pools yield one reservation. Replay, late resolution, policy publication races,
backend loss, rollback and lost commit acknowledgement are covered. Protocol seams independently
reject timeout/partial-shard/incomplete-page responses. Those seams do not substitute for live
backend acceptance. Native installation evidence will identify the tested source revision.

This is manual evaluation of recorded normalized alerts. Separate durable OTLP observations,
telemetry windows, anomaly detection, automatic consumers, conditional evidence collection,
canonical dispatch and action/synchronization remain unfinished. A pending reservation is not
an executed capture, investigation, or approved infrastructure action. See ADR0010.

## Workspace and navigation correction

Kernel `aac99fb` is running in the local Kubernetes installation. The original pressure
ticket's three accepted reports survive the source upgrade and download with exact
recorded digests from the standard PVC through authenticated endpoints. These are
workflow-generated reports; no generated remediation script is claimed. Unit and real
native worker tests prove persistence before advancement and keep stale execution
refused. Browser approval of disposable installer ticket `1ec9b0c0` reached Complete through the native confirmed endpoint. Named CLI remediation generation remains open.

ADR0012 defines the YAML-owned Operations toolbar and application-preserving ticket
links. The global toolbar now checks current route ownership, active package state and
caller admission. Installed toolbar acceptance passes with kernel `57abf31` and application `1a02c4ca`.


## Installed graph explorer and processing experience

The installed Operations package is source `1a02c4ca` (artifact
`47a0936ce9441f31bffe42cc6cebaeb5b78e3e7bcb0923190a66b15a718c93da`), with native
kernel `57abf31`. The YAML toolbar opens the declared Operations, Topology and Data
screens, retains Tickets, and respects loaded-package/current-user admission. Shared
cockpit query forwarding now preserves page fragments. Native SQL now loads constraint
dependencies of previous transaction reads before whole-snapshot integrity checks.

`lab/detection_verify.py` passed through the actual installed HTTP routes and OpenSearch
3.3.2: 37 rules published, 36 enabled rules matched each of 30 selected alerts, 70 of 100
labeled synthetic occurrences filtered, three admitted symptoms, 27 duplicates suppressed,
three evidence reservations, and two correlation groups connected through one observed
container-to-pod path. Replay retained the original count. Anonymous reading refused with
HTTP 401. The receipt is [detection.json](../../deploy/evidence/detection.json).

Actual browser checks independently show 100 → 30 (30%) → 3 (3%) → 2 groups, with all
three survivors covered by the saved correlation analysis. The graph loads 18 actual
Kubernetes assets and 32 relationships; searching and keyboard selection open a pod's six
observed directed relationships. Inventory timestamps remain explicit. Counts cover the
returned decision cohort, not unbounded installation totals. Kind search import aliases
are verified against the pinned local image content on all three nodes.

Verification: 52 Operations cases pass without skips; 295 kernel package tests, two native
SQL integration cases and two surface URL cases pass. Scoped Clippy, formatting and diff
checks pass. The normal Store gate passes 83 checks, with six partial and twelve explicitly
skipped jobs requiring other fixtures or the retired platform. A broader kernel Clippy
run still reports five existing `unwrap()` lints in `cli_accounts_api.rs`; full kernel
release certification remains open on draft PR 72.

Continuous ingestion/processing, separate OTLP observations, anomaly detection, automatic
evidence consumers, workflow-generated remediation scripts, approved execution, and
external ticket synchronization remain unfinished. Three reservations do not establish
that those consumers ran. The original pressure ticket remains awaiting human acceptance;
this graph/pipeline acceptance performed no infrastructure remediation.

## Durable background evaluation — source increment

ADR0014 adds an opt-in native personal schedule for exact source revisions with published
policies. The existing admitted-delivery queue supplies fenced leases, bounded retries,
explicit exhausted-work recovery and durable completion. The Data pipeline exposes
configuration, schedule activation/pause and job status separately. All 60 Operations
SQL/OpenSearch/browser contracts pass without skips. Native source `8b3c2cbc` processed
seven labeled acceptance alerts on actual personal scheduled ticks; the first six
yielded four matches, two filtered events, one new symptom and three suppressed repeats.
A 65-second pause retained new work, and reactivation completed it. No manual processing
call or schedule trigger was used. The worker was disabled after acceptance. A follow-up
locks configuration through decision commit to serialize disable acknowledgement; its
real PostgreSQL race regression and final installed acceptance both pass. The receipt is
`deploy/evidence/processing.json`. This closes source implementation of queue draining, not external
producer admission, scheduled correlation, evidence collection, anomaly detection or
remediation execution. Full P1–P9 and M2–M8 completion remains open.

## 21 October: retained streams and datacenter replay

Source now adds three scoped telemetry banks, minimum900-second protection, atomic backpressure/retries, OTLP JSON logs/numeric metrics, mapped decoded CloudWatch intake and durable reservation-bound context packets. Live context and Scenario lab views expose mappings, bank generations, actual reduction counts and paths. The separately cached 18-file research set is 3,492,896 bytes. The BGL severity baseline has run; NAB anomaly evaluation and physical backing-store autoscaling have not. See STREAMS-AND-REPLAY.md/ADR0020 for exact boundaries; source checks and native acceptance receipts follow separately.

Native dbb862a0 acceptance now passes actual HTML login, standard OTLP/CloudWatch intake,100→40→4→2 dependency replay, four durable context packets and desktop/phone checks. Source benchmark over2,000 recorded BGL lines yields35.48% precision/100% recall for a label-blind severity baseline (260false positives), not a trained detector. Follow-up source adds bounded bank growth and reviewed ceiling increases. The first normal push ran all gates but failed Publishing's missing prepared runtime variables; its unchanged23-case suite passes once the existing hash-pinned runtime is supplied. No gate was bypassed; subsequent normal pushes passed with those prerequisites.

Real native retention acceptance passed at909.788seconds with no clock changes: early429, safe bank reuse, unchanged pinned packet hash and all three original packet facts retained. Native bank-growth acceptance retained12rows at three4-row ceilings, refused the next, then accepted after a reviewed increase. Full Store push is green with83passed checks,6partial and12explicit skips;7a119bfc and the previous saved checkpoints are now on origin/feat/native-application-executors.

Actual pinned Collector acceptance passes RFC5424/TCP and OTLP numeric gauge export into the native context store:2syslogs/1metric, explicit resource identity, temporary existing-user session, removed bounded Collector. Permanent producer enrollment/TLS/queue deployment remains separate. See standard-stream.json.

Final native acceptance at application `3c557c4a` / artifact
`4e324173ffa3b2edae0f495aedc1ce9b3fe7973759b0f78bc8dbc7b143c577c4`
passes actual HTML password login, all replay stages, four packets and desktop/phone
layout. A fresh page reopens the server-verified saved cohort without rerunning events.
The complete native acceptance took 169.88 seconds, including setup,
processing and layout checks; this is not a production latency percentile. The
committed-source export passes 21 focused package/replay/telemetry checks, no skips.
`deploy/evidence/replay.json` retains exact source, times, cohort hash and checks.
The latest source uses the same own-scope admin grants; no core source change,
cloud resource, model call or infrastructure remediation was needed.

## 21 October continued operating experience (in progress)

The operator explicitly requires continuation beyond replay. ADR0021 adds the rule
workbench: names, enable/capture choices, explicit suppression windows, AND-condition
builder, saved-generation drafts and actual percolation trials. Source acceptance is
85 passed / zero failed / zero skipped, including actual SQL/OpenSearch and browser
editing/activation/denial cases. Native deployment/acceptance follows; the existing
3c557c4a installation does not yet expose this editor. The rerun live monitoring
baseline passes real HTTP failure/firing/webhook/recovery/clearing/scaled UID checks
and restores two healthy API replicas (`deploy/evidence/live-monitoring.json`).
Continuous product source admission, third-party patch/configuration/node drills,
canonical automatic workflow and generated remediation remain active work, not
completion claims. OPERATING-GUIDE.md records usable controls and current wiring.

## Live operating continuation

Source7ed15232 is installed, artifact da464f4c7556f0dfa80057febad1fa6fd77c986b6b7045c2624835bbacecc315. Actual password-login/browser acceptance passes candidate1/3 matches without activating it or creating decisions/evidence work, followed by explicit activation revision2; desktop/phone checks pass. The sanitized receipt is deploy/evidence/policy-workbench.json.

The next increment adds an actual CPU-rendered 3D graph with six bounded predefined queries, perspective depth, orbit/pan/zoom and accessible selection, retaining 2D. Focused graph/Systems/SQL/browser tests22/0/no skips pass. Native3D deployment is still pending at this source checkpoint. The complete lifecycle funnel, AI assessment/recovery records, external status synchronization and shared SMS/voice activation remain active build scope; graph navigation alone supplies none of those claims.

Source investigation increment: a durable evidence-to-canonical-ticket association, unknown-create hold, immutable dispatch JSON and receipt-based AI/report funnel are implemented. Five focused SQL/browser tests pass; native deployment/model acceptance is next. The graph asset now has explicit GET/HEAD read bindings and a regression covers all shipped scripts.3D source ddf7be62 is pushed; native's first staged graph asset lacked its permission binding and requires this corrective artifact before3D acceptance can pass. No claim of live3D was made from that initial installation.

Kernel source311cb7a adds package-specific operator private HTTP pins;92da94c adds native SMS and private supported-env import. Focused4 private-HTTP,3 SMS TLS,8 channel API and16 installer tests pass; strict all-target Clippy passes. Full clean-export kernel CI is running and has exposed baseline fixture assertion failures, so these services are not yet deployed or certified. External ticket sync, multi-file generated scripts and real infrastructure recovery remain unfinished.

Complete Operations source suite94/0/no skips passes after the investigation browser path, script admission and immutable-input corrections. This is isolated source verification, not native inference or full pipeline acceptance.

Native24d62980 artifact16a4b695f0c3... passes actual HTML login, all six3D presets, orbit-pixel changes and phone layout. A synthetic alert plus one retained OTLP log enters the real canonical workflow under the original owner: ticket ca7fc196-8a0b-4055-809d-7b957cde68f9. The genuine investigate-phase output has an inference receipt and its4709-byte answer.md is visible via the canonical shared-workspace API. The UI shows one completed assessment without claiming recovery. Sanitized proof: deploy/evidence/operating-experience.json. The worker generated its report; no executable remediation bundle or infrastructure action is claimed. A viewport-fit/shaded-node polish passes the existing four graph tests and follows in the next artifact.

Native a8697163 artifact57abd4068306de832db2828bab0ed9141a0060bd5c05a001e601e2a7acee4505
passes the fitted 3D view and six queries at the original observation time. The
existing canonical acceptance ticket has completed investigate/review/revise and
is awaiting approval. Three authenticated shared-PVC downloads match their stored
byte counts and SHA-256 hashes. Sanitized separate receipts are graph-experience.json
and workflow-artifacts.json. No additional model dispatch or external action was
performed by these rechecks. Nine focused graph/investigation tests pass.


21 October — installed service/handoff controls: application400a15f7 passes real portal password login, current-person connection/notification standing and the manual ticket-handoff schema/refresh path. Sanitized evidence: deploy/evidence/services-standing.json. No live provider write is claimed. Core579c8fd adds default-off brief phone alerts and exact named-account selection;6 real TLS transport tests,9 native channel tests,19 installer tests and strict workspace Clippy pass. The full kernel run found two stale fixtures;8d447c0 corrects their actual input/application assumptions with39 focused tests passing. The final full gate and rollout remain pending, and all three explicitly authorized communication tests remain unsent.


21 October — local development service acceptance (ADR0026): kernelac5f00e is installed with image/binary digests and a rollback snapshot, preserving the complete pod configuration apart from image/source annotations. The standard installer configures the shared services. Exactly one SMS, one brief phone and one Telegram attempt have transport acceptance, and all test topics are muted. Telegram's older response was reconciled explicitly without a resend; the operator confirmed the phone call. The SMS was subsequently confirmed undelivered with Twilio error30034 (unregistered US A2P sender); Telegram human receipt remains unverified. Native service/handoff controls and all three existing workflow-generated files pass rechecks. Jira invocation scope and selected account are linked, but its read-only profile returns HTTP404; no external issue was changed. Full kernel certification remains open: cache/fixture fixes are committed through af5afcb, and the 264MiB stream expiry remains an unresolved full-gate result. The app milestone is merged as PR543/e0ef6f4f; neither that merge nor local development acceptance certifies the full event-to-action product.

21 October — decision visibility correction (ADR0027): native activity's unmeasured placeholder and list-only workflow view are replaced in core ADR190 by ticket-attributed reference estimates, exact source-checked input lineage, actual bot decisions and a read-only Studio runtime graph. Source UI70checks and estimator unit cases pass; live deployment acceptance remains pending. Specialist/reviewer instructions now demand evidence citations, decision tables and scoped script proposals; existing reports are retained unchanged. Create will be installed as the broader studio shell around the existing AI Office component. Email notices use a dedicated filtered mail catalog; a mailbox connection remains distinct from portal email transport.


21 October — installed decision-chain acceptance: development kernel 6f1c38f and
account runtime 782ae3d now pass10 actual HTML/browser/API checks. Public Operations,
Communication and Create are installed from bceffaf0. A real Prometheus/Alertmanager
fault drill against an explicitly synthetic local workload admitted 8 captured
observations into a sealed packet. Original ticket 2a60f877 failed with codex_timeout
at 45 seconds; its history is retained. A single linked retry 537d9d04, after the
bounded central deadline correction, completed investigate/review/revise and awaits
human report approval. All 3 shared-workspace reports were downloaded and matched
to native byte lengths and SHA256 digests. Revise received both prior reports.
Evidence and decision tables cite actual packet fields; diagnostic/verification
scripts remain proposals within reports, not separately materialized executable
files. No infrastructure execution or external synchronization occurred.

The 3 successful calls report39,166 measured input/output tokens, $0 recorded spend
and a separately labelled $0.050048 reference estimate at the installation's
$1 input/$3 output per million token assumptions. That assumption is not a provider
price. The earlier failed call has no successful usage receipt, so its provider
consumption is unknown. Desktop/phone Studio graphs, named decisions, Create home
and Gmail/Outlook filtering pass. Personal mailbox consent, provider callback
registration, portal SMTP/webhook delivery and full kernel certification remain
open. Sanitized receipt: `deploy/evidence/decision-chain.json`.


21 October — Create suite and RCA delivery (ADR0029): Create 1.15.0 already matched
repository main; missing optional Video/Vids, Publishing and PDF Workbench packages
are now admitted under the declared selected Create administrator composite. Native
Create UX imports two real one-second test clips, saves and exports a verified
60-frame 1280x720/30fps splice. Exact 0700 scratch initialization fixes Kubernetes
SGID inheritance without changing the editor guard; pod replacement is verified.
Jarvis's operator-evidence-based Word outline was rendered by the actual native
Publishing/Office APIs into an eight-page PDF and eleven-slide PowerPoint including
cover. Both hashes/content checks pass. Google callback registration and personal
consent are now complete; Gmail accepted two one-attachment messages under the
explicit recipient authorization. Human inbox receipt, automatic multi-artifact
handoff, canonical ticket-workspace placement and full kernel certification remain
open. Code Server stayed ready during kernel replacement; forwarding and editor
health are restored. Sanitized proof: `deploy/evidence/create-suite.json`.

## Planned Git / Jarvis hierarchy — 21 October

The [promotion roadmap](SWARM-PROMOTION-ROADMAP.md) is scoped, not implemented. Credentials & access source adds standard cloud, Git and email entry points; local AWS/gcloud sign-in is explicitly separate from portal grants, and Azure has no current Node login control. No Git write or cross-swarm promotion is enabled by these links.

## Response design prototype — 21 October

Four interactive synthetic screens cover response selection, exact-change review, recovery signals and lower-swarm permanent-fix delivery. Browser tests exercise four routes, local approval gating, healthy/regressed/missing/incomplete health states and three viewport sizes. The prototype performs no live writes; post-change watchers and cross-swarm execution remain proposed. See RESPONSE-PATH-DESIGN.md and ADR0031.

## Resource workbench — source only

The operator-focused Systems tree/detail view, compact shared layout and native-only embedded navigation are implemented in source (ADR0032). Focused tests cover identity, cycles, keyboard behavior, captured status, safe text and narrow layouts. Actual installation and current-cluster acceptance remain pending. The terminal and historical RCA reference library are active backlog items, not delivered controls.

## Historical RCA library — source only

The RCA library reads current-user canonical ticket/work/artifact sources, exposes receipts and original input digests, and preserves missing lineage, unavailable runs and report-acceptance status. Four focused tests cover source projection, exact download selectors, browser citations/safe text, narrow layouts, refusal and stale responses. Live acceptance remains pending; semantic indexing and admission of historical cases into new AI input are subsequent work.

## Operator workspace increment — 21 October 2026

Native registry source `36af9dd6` is installed (artifact `82bb286db8bf5052874e11bc77d2ce1bdca8f449b8bee7d9e364a4aabb2cbf39`). Browser acceptance shows one embedded navigation surface, Systems as default, expandable real lab ownership, and the historical RCA library with original ticket/work receipts, hashes and three accepted report links. A fresh complete capture collected actual lab inventory through the existing scoped collector. Pod console source/browser contracts are implemented; native Kubernetes rollout and actual command/analysis acceptance are pending.

## Selected pod workbench — implemented source and checked native boundary

The source-pinned development kernel `65ed1926` is installed with workspace, account runtime and pod configuration preserved. The standard optional `pod-access` installer selected the local API/CA and a namespace-only pod/log/exec account. Native status and exact exec return verified results; secrets and foreign-namespace reads return 403 and stale UID execution is refused. Actual container cgroup v2 memory and CPU counter reads pass. Browser current inspection and reviewed identity-command execution pass. No cluster-admin credential entered the portal or the analyst.

The source workbench now presents current health/readiness/restarts and output directly, raw receipts under Advanced, named diagnostic tasks, and an inspectable `pod-analysis-v1` packet. Only the selected container and explicit bounded result fields reach analysis; output truncation is labelled, general application summaries are omitted, and command suggestions require a new exact operator review. The existing analyst retains its ticket/report and general concierge behavior outside this console mode. Persistent TTY, multiple clusters and automatic historical-case retrieval remain backlog items. The kernel PR remains draft because full canonical certification is still red.

## Scheduled retained evidence — source increment

ADR0035 adds an explicit capture setting to the existing personal evaluation schedule. Reduced reservations now have an atomic retained-packet consumer, bounded retries and source/configuration fences; missing context and non-capture rules remain explicit. Focused SQL/OpenSearch/browser checks exercise the consumer. Native rollout acceptance remains pending. The full delivery audit remains open, including continuous producer admission, correlation, canonical dispatch and exact approved recovery.

## Consistent operator workspace — source increment

The [operator guide](OPERATOR-WORKSPACE.md) describes the new attention overview, compact Systems workbench, five pipeline views and searchable source revision/detail panel. Event inspection presents a decision trail before raw data. Cross-screen links use the existing native manifest navigation so the cockpit rail follows the destination. No core change or new action authority is introduced. Source and browser checks precede a separate exact-revision installation receipt; this source checkpoint alone does not establish deployment.

Focused candidate checks: operator navigation/source inspection and current-access clearing pass; the real SQL/OpenSearch browser journey still publishes rules, evaluates selected events and saves correlation. Delivery retries/conflicts remain available alongside the readable trail. Full Store results and installation identity are recorded only after publication.

## Native operator workspace and scheduled capture acceptance

Application `8e259b15` is installed through native source trust, artifact preview and the existing own-scope operator composite. The four screens and source-to-event/rule navigation were inspected in the native cockpit. The complete Operations package suite passes, with eleven clean-export checks at 3155da06 for navigation and topology, plus three correction UI tests at 8e259b15. The normal Store gate passes with its explicitly named partial and unavailable prerequisites.

A real personal schedule processed five synthetic occurrences without calling processing or manual schedule triggers: four matches, one new symptom, three suppressed duplicates, one unmatched event and one immutable packet holding the prior retained observation. Its digest matches durable completion; an inspection reused the same packet. After a duplicate-withdrawal cleanup error, the durable result was reconciled without rerunning the cohort. Processing and capture are disabled, the temporary source scope is cleared and the schedule is inactive; exact prior settings restoration is not claimed. No model, infrastructure command or outbound notification ran. Receipts: `deploy/evidence/operator-workspace.json` and `deploy/evidence/scheduled-capture.json`. Automatic correlation/dispatch, generated executable remediation and recovery remain open.

Native Systems current-status read for the selected captured pod returned upstream unavailable. The resource tree and saved observations were verified; that read is not a successful live console acceptance and remains in the backlog.

## Scoped pod connection recovery and compact Systems follow-up

Native application `fd4cb55c` and development kernel `fe10403` are installed. The failed live pod read was traced to a one-hour issuer credential stored without an expiry by the shared manual-connect path. Kernel ADR192 adds manual expiry admission and a standard `pod-connect` installer command; it renews the existing namespace-scoped account under the same portal login. An intentionally shortened local deadline produced `expired` and an actionable HTTP403 refusal; the actual installer then renewed the account with the issuer deadline. Native API and browser current-status reads show the original pod UID Running, container ready and zero restarts; bounded log retrieval completed with no lines. No exec or model request was made. The credential still expires in one hour; automatic renewal is not claimed.

Systems filters now fit one compact desktop row, and searching preserves the observed cluster name without adding filtered resources. Eight focused projection/browser tests pass from the committed export; the normal Store gate reports83pass/0fail/6partial/12named skips. Shared connection tests7, installer24, namespace setup4, secret guard8 and strict workspace Clippy pass. Receipt: [pod connection recovery](../../deploy/evidence/pod-connection-expiry.json). Earlier failed-read receipts remain historical evidence, not current recovery claims. Full kernel certification and the remaining Event-to-Action requirements stay open.
