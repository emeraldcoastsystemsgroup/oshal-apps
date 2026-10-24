# TriageNorth delivery plan

Updated 21 October 2026. The existing `intelligent-operations` package is the application boundary. Keep its specialist identities and ticket workflow while building Operations as an OSHAL experience slice. User login, current-caller connections and granular tool/ticket authority stay with the standard framework. Decisions and their implementation status are tracked in DECISIONS.md and ADRs 0001–0027. The design proposal and Visio drawings describe the target; this plan and [implementation status](IMPLEMENTATION-STATUS.md) describe delivery.

The operator has supplied a **three-week improvement horizon**. The prioritized
[three-week plan](THREE-WEEK-PLAN.md) adds dataset-based evaluation, economical local
text analysis, incident replay, visual-depth topology and the pitch/document package.
It preserves the full milestones below. Dataset provenance and preparation results
are in [evaluation-data.json](evaluation-data.json); this is not a detector score.

Functional priority starts with the [Systems investigation view](SYSTEMS.md),
implemented in source with twelve focused checks. The three-week plan assigns
repeatable troubleshooting scenarios across Kubernetes, provider/host records,
metric replay and external ticket integration. Every reproduced failure should
produce evidence, a focused fix and a retained regression case. The installed package and normal publication gate now pass. Systems-specific live
two-user acceptance and full product end-to-end acceptance remain separate work.

## Current supervised baseline and next dependencies

The operator resumed Docker and development on 21 October. The native portal,
shared workspace, editor, worker, PostgreSQL and detection backend are running.
Explicit 3/8/5-GiB node budgets and the existing placement/host checks admit this
local profile. The development kernel now uses source 6f1c38f, and the account
runtime uses source 782ae3d with bounded90/105/120 second model/request/phase
deadlines. Full kernel certification remains open. The overnight heartbeat remains paused.
[RESOURCE-REVIEW.md](RESOURCE-REVIEW.md) retains the historical incident and current
startup limits; its former no-start restriction is superseded by the operator.

Completed context/replay gates: three scoped banks with safe growth/backpressure;
real 15-minute raw-reuse and packet-survival acceptance; OTLP/CloudWatch mappings;
actual RFC5424 Collector export; 100→40→4→2 native dependency scenario; durable
server-verified saved cohorts; a measured BGL severity baseline; current pitch artifacts.
All 83 Operations tests pass. Normal publication has zero failures but names six
partial suites and twelve missing prerequisites; these are not passed certifications.

The [delivery audit](DELIVERY-AUDIT.md) retains the full M2–M8 and P1–P9 scope.
Next dependency order is permanent delegated producers, scheduled fresh inventory,
calibrated anomaly evaluation, automatic packet→canonical ticket/workflow linkage,
workflow-generated scripts, exact approved action/recovery, then external synchronization.
AWS/Azure/GCP educational environments follow product/read-only discovery readiness.
No paid cloud resources are provisioned in the sample-data increment.

## Outcome and scope

Demonstrate a controlled failure in a local Kubernetes environment, preserve evidence before a container disappears, consolidate repeated symptoms into one incident, propose reviewable work, authorize an exact action, and verify recovery. A person must be able to understand what is observed, what is inferred, what needs approval, and what remains unavailable without reading implementation details.

The full product includes data center, cloud, host and container inventory. The first live environment is an isolated local Kubernetes cluster. AWS, Azure and GCP discovery share a contract and fixtures before separate live-provider acceptance. Do not represent fixtures as live connections. Plan against the supplied three-week horizon; the exact hackathon date and available provider accounts remain unconfirmed.

## Hackathon installation baseline

Install the public Operations, AI Office and Intelligent Communication packages after the
kernel, with built-in Jarvis and Workflow Studio. Exclude Finance and the broad umbrella
bundle. Native source trust and artifact previews precede package installation; user roles
and current-caller connections remain OSHAL responsibilities (ADR0006).

Before the runtime stop, the isolated installation had five active packages, admin Operations/Jarvis assignments,
verified desktop Codex/Claude transfers, explicit Codex selection with Claude fallback and
a real locally generated Office file. Its admin view includes six recorded lab alerts and
two historical inventory captures. Telegram transport and connector setup are shared-kernel
work. Complete mailbox sign-in and record actual Telegram delivery separately; do not mark
M2 ingestion, M4 reduction or automatic event notifications complete from this baseline.

## Ordered milestones

| Milestone | Depends on | Deliverable and experience | Acceptance gate |
|---|---|---|---|
| M0 Plan and architecture | Existing design | Versioned proposal, dependency register, ADR decision log, editable Visio, delivery sequence and demonstrable scenario. | Requirements trace to a milestone; planned and implemented capabilities are distinct. |
| M1 Application foundation | Native package assets and ticket projection | Package-owned responsive experience under the OSHAL session, real incident-ticket read, useful empty/error states, local source-format preview and current-caller connection entry points. | Existing ticket/bot identities preserved; only authorized kernel ticket reads; no generated health or implied ingestion; browser and input-contract cases pass. |
| L1 Reproducible test estate | Local Docker, pinned Kubernetes tooling/images | Separate local cluster, representative service dependencies, monitoring and bounded fault/load scenarios. | Context isolation, resource limits, healthy baseline, observable fault, recovery, actual captured samples and teardown verified. |
| M2 Sources and durable ingestion | M1, L1, source-principal and scoped-store contracts | Named source registration, authentication, versioned mapping editor, durable raw delivery and idempotent acceptance. | Source spoof, unknown identity, duplicate/reused ID and partial failure cases; acknowledge only committed input; no change authority from a source. |
| M3 Inventory and topology | M2, discovery principals | Kubernetes discovery and temporal graph, placement history, independent identity/health/freshness; provider discovery adapters and fixtures. | Scale/replacement/movement reflected; failed or partial scans cannot delete inventory; historical topology remains readable; unauthorized graph traversal refused. |
| M4 Detection and incident reduction | M2, M3, stored-rule backend | Telemetry records, percolation plus time-window evaluator, stable symptom keys, bounded correlation and canonical ticket link. | Raw versus telemetry view explains every scoped decision with mapping/rule versions; 100 repeated symptoms update one incident; distinct alert types stay distinct; concurrent reserve/retry and restart tests; no AI before dedup; counted unmatched input. |
| M5 Evidence and investigation | M3, M4, read-only collectors | Conditional snapshots, evidence manifests, optional external enrichment, investigation/review/revision inside the incident workspace. | Capture before pod removal; failed/missing/truncated evidence visible; packet items carry source, time and hash; reads cannot mutate infrastructure. |
| M5b External ticket synchronization | M4, shared confirmed writes, verified webhooks, current-caller connections | Linked ServiceNow/GitHub/GitLab/Jira records; outbound and two-way policies, field ownership, status mapping, revision/origin history and conflict UX. One live disposable provider first; all four target coverage. | Shared operation gaps resolved per provider; cross-user/account refusal; duplicate/feedback/reordered webhook; lost create response reconciled; no duplicate ticket, blind retry or false recovery. |
| M6 Work delivery and approval | M5, verified native approval and artifact APIs | Versioned report/code bundle, file diff, validation, download and approval of exact version/targets. | Changed digest/target/principal/expiry invalidates approval; no secret in bundle; download does not imply execution. |
| M7 Bounded execution | M6, registered runner/tools and policy API | One-time execution, explicit delegation, pause/revoke, verification and immutable receipts. | Viewer denied; approved action runs only on admitted target; failed postcheck leaves incident open; unknown external outcome not blindly retried. |
| M8 Hackathon acceptance | All live vertical-slice gates | Guided demo, evidence receipts, installation/cleanup guide, measured results and known limitations. | Replay from a clean lab; no hidden operator fixups; real versus synthetic data labeled; normal repository checks and push gate reported honestly. |

M1 and L1 establish the first development increment. M2 through M7 are separate coherent releases, not one large unreviewable change. M8 may use one narrow registered recovery action; broad production remediation is later scope.

## Dependency register

| Dependency | Availability or work required | Consumer and release condition |
|---|---|---|
| Package loader and asset admission | Existing native assets and declared experience launcher; installed Operations browser behavior verified in the isolated Kubernetes lab. | M1. Manifest tile and current application grants gate entry. |
| Package audit and release admission | The 1.1.0 audit record remains pending; no approval or verified source SHA is asserted. | Required before a fresh accepted installation. A published source commit or readiness smoke does not establish audit approval. |
| Shared identity and permissions | Existing admitted kernel requests. New source and collector principals require native contract verification. | M1 reads use current session. M2 onward must fail closed on missing scope or withdrawn grants. |
| Canonical ticket workflow | Existing `intelligent-operations` and imported `intelligent-processing` queues, specialist and reviewer. Ticket projection is tenant-visible with private text filtered by the kernel. | M1 reads exactly the returned projection. Later incident linkage does not create a second ticket engine. Workflow completion is not verified infrastructure recovery. |
| Scoped application store | Native person-scoped store exercised through actual package routes and pod replacement; transactional intake/decision reservations remain unverified. | M2. Raw payload, source, mapping and receipt commit atomically under the correct scope. |
| Credentials and connection broker | Standard kernel connections define personal/shared ownership, named-account selection, liveness and guarded calls; verify installed current-caller APIs and delegated calls. | Saved connections and collection. Never persist credentials in browser storage, package files or generated bundles. |
| Local test cluster | Docker available; install isolated pinned tools without changing the default kubeconfig. | L1. Named cluster/context, bounded workloads and repeatable lifecycle scripts. |
| Monitoring and telemetry | Lab Prometheus, Alertmanager, state metrics and OTel collector; source integration follows M2. | L1 produces real local samples. Collection is not equivalent to OSHAL ingestion. |
| Detection backend | Confirm stored-query/percolation deployment, supported rule subset, retention and credentials. | M4. Keep windowed aggregation separate; do not call a simple field filter a completed percolation backend. |
| CLI and discovery identity | Verify brokered operator/workload sessions on the selected runner; bind explicit provider scope and tool configuration. | M2/M3. Independent auth/inventory/evidence probes; refuse missing tool, wrong target, expiry and revoked grants. See CONNECTIONS-AND-TOPOLOGY.md. |
| Temporal graph | Reuse established correlation semantics behind package-owned inventory and typed relationships; verify available shared graph API before choosing storage. | M3/M4. One graph feeds both map and correlation; source validity and historical membership are persisted. |
| Cloud discovery | GCP Asset Inventory, Azure Resource Graph plus service APIs, AWS resource APIs/Config where enabled. Accounts/scopes required for live acceptance. | Fixtures first; each provider enabled and labeled live separately. Discovery does not grant guest or write access. |
| Physical inventory | Redfish, network/hypervisor connectors and authorized imports. | Later breadth. No claim of automatic facility discovery from cloud inventory. |
| External evidence | Optional Splunk or another authorized query connector. | M5. Splunk's fixed personal read and incident manifest are source-implemented (ADR0052); native lab and credentialed provider acceptance remain. Missing enrichment does not lose the incident; show collection status and time coverage. |
| Artifact and validation services | Verify native artifact handles, exact content versions, expiry and supported validators. | M6. Build reports, manifests and deterministic work bundles without secrets. |
| Approval and delegation APIs | Verify exact native digest/target binding, expiry, recheck and withdrawal; identify shared gaps explicitly. | M6/M7. Do not emulate privileged execution in application routes. |
| External ticket connector coverage | Kernel declarations exist for ServiceNow, GitHub, GitLab and Jira; ServiceNow reads only, other create/comment/webhook coverage differs. | M5b. Extend standard connector operations and verification; no app-private auth or direct write bypass. |
| External ticket sync store | Scoped link/policy and durable operation/outcome/revision/origin records required. | M5b. Shared ticket remains canonical; reconcile uncertain creates and prevent feedback loops. |
| Registered execution tools | Verify supported sandbox/runner, bounded output, provider-scoped capabilities and postconditions. | M7. A generated script is reviewable before it becomes an executable tool. |
| Test and release prerequisites | Store toolchain; disposable PostgreSQL; Publishing renderer runtime; legacy checks named by the gate. | Every release. Existing full gate currently needs missing fixtures; no hook bypass or invented pass. |

## Lab test data and scenarios

Use representative services with actual dependency calls, health/readiness probes, request metrics, structured logs and resource limits. Monitoring runs in its own namespace. Generated data carries the lab source, environment and scoped resource identity. Export sanitized samples, actual collection times and scenario receipts; keep kubeconfig and runtime credentials outside the repository.

| Scenario | Pressure or change | Expected evidence and acceptance |
|---|---|---|
| Healthy traffic | Bounded baseline requests across service dependencies. | Requests succeed, targets are monitored and inventories have current observation times. |
| Repeated application failures | Bounded requests with deterministic error mode. | Repeated HTTP errors, logs, metrics and alert firing; later one incident with occurrence count. |
| Container restart loop | Explicit fault mode on a disposable workload. | Current/previous logs, restart count and changing container IDs; capture before replacement. |
| Readiness failure | Service stays up but readiness returns failure. | Not-ready endpoint and reduced service availability; distinguish this from process exit. |
| Scale and replacement | Scale only a named lab deployment; replace an owned test pod. | New instance UIDs, retired instances and workload continuity; inventory reconciliation proof. |
| Recovery | Restore healthy configuration and verify a fresh request. | Recovery metrics and resolved alert, with postcondition evidence rather than command exit alone. |
| Noise replay | Replay sanitized actual local alert payloads with explicit duplicate/new IDs. | Delivery idempotence differs from repeated independent occurrences; source/type/asset keys remain distinguishable. |
| Missing evidence | Remove a captured test pod or deny a collector read. | Honest unavailable/denied status, no fabricated replacement evidence. |

All destructive scenarios remain scoped to the explicitly owned local cluster and namespaces. Load generation has a maximum request count, time, concurrency and pod resource limit. Cleanup restores healthy state and removes temporary jobs; cluster deletion remains a separate explicit command.

## Requirements and usability traceability

| Requirement | Milestone / ADR | Observable user acceptance |
|---|---|---|
| OSHAL experience and user-bound authority | M1/M2; ADR 0001/0004 | Single OSHAL session; current-caller connections, cross-user refusal and revoked-access handling. |
| Inbound source identity and mappings | M2; ADR 0002 | Inspect sample, missing identity, source mismatch, saved mapping version and committed receipt. |
| Cloud/host/container topology | M3; ADR 0004 | Typed edges, source/freshness, changing instance IDs, event-time view and incomplete-scan status. |
| Filtering and noise explanation | M4; ADR 0002 | Compare delivery retry and symptom update; inspect key, rule version, suppression, correlation and packet decision. |
| External ticket synchronization | M5b; ADR 0003 | Inspect direction, mapped changes, caller/account, denied/expired state, conflict, feedback suppression and uncertain-create reconciliation. |
| Reviewable work and controlled effect | M6/M7; ADR 0001/0004 | Inspect bundle, exact approval, verified outcome and durable receipt without hidden privileges. |
| Usability | Every milestone | Keyboard and 320/390/1440 pixel layouts; useful empty/error states; no unsupported capability presented as live. |

## Experience and accuracy definition of done

Every feature ships with its user's task, actual backing contract, empty state, disconnected/error state, freshness behavior and authorization refusal. Keyboard navigation and narrow screens must work. Hide or clearly mark unfinished controls instead of exposing buttons that pretend to save, connect, approve or run.

Use semantic distinctions consistently: source accepted versus authenticated, payload format valid versus asset resolved, discovered versus healthy, workflow finished versus incident recovered, proposed versus approved, and command completed versus effect verified. Do not aggregate unlike quantities or treat unavailable data as zero. Clear sensitive rendered data when access is refused; stale responses must not overwrite newer results.

Source-contract and incident-key tests exercise stable IDs, missing scope, malformed time, oversized input, repeated delivery and distinct symptoms. Browser tests exercise actual shipped files with explicitly labeled HTTP fixtures. These do not certify kernel authorization or a live provider. Native installed acceptance and real-lab acceptance receive separate receipts.

## Documentation and delivery discipline

Update implementation status, package README, source schema examples, operator instructions, tests and milestone evidence in the same coherent change. Revise the proposal and regenerate Word/PDF/Visio when the architecture or intended experience changes. Do not regenerate design artifacts merely to announce routine progress.

For each release record version, source commit, checks actually executed, fixture/provider limitations and installation status. Stage only this task's changes, including only its hunks in shared catalog/README files. Preserve other work. Keep hooks enabled, commit small changes and push normally. If the gate refuses a push, retain the commit and name the exact prerequisites rather than changing unrelated code or bypassing checks.

## Next implementation work

1. Deliver and verify M1 and L1, recording actual results in implementation status.
2. Validate native source authentication and package-store transactions, then implement M2 source registration and durable intake with the lab receiver as a test source.
3. Add Kubernetes discovery before showing a live topology map.
4. Validate standard connector write/webhook gaps and implement M5b synchronization without bypassing the shared framework.
5. Run the remaining milestones in dependency order, keeping the reviewed action and demo scope narrow until the complete path is proved.

## Deployed increment — 20 October 2026

M1 now has a running native Kubernetes experience with real OSHAL login, reader/operator grants,
person-scoped persistent records and responsive browser acceptance. L1 has repeated real
fault, webhook, recovery and pod-replacement acceptance. The deployment pins the native kernel
and builds the application from a committed snapshot. PostgreSQL and application state use PVCs.

M2 is partial: named immutable source/mapping revisions and authenticated manual imports work;
exact retries share a saved record and missing identities remain inspectable in quarantine.
Remaining: background source principals, producer authentication, durable delivery-attempt ledger,
reused-ID conflict policy and concurrent transactional admission.

M3 is partial: actual Kubernetes UID/node/container snapshots can be imported and compared in the
experience. Remaining: scheduled discovery, temporal graph reconciliation, independent service/node
health, authorized collection bindings and cloud-provider acceptance. Historical pod readiness does
not assert network health or current service recovery.

Next build order remains M2 complete, M3 collection, M4 established reduction and telemetry,
M5 evidence, M5b provider sync, then M6/M7 approved work and execution. CLI login activation and
ServiceNow/GitHub/GitLab/Jira writes stay within the shared connection framework. The current
Connections view reads native account status; it does not claim provider/tool activation.

Installed checks and their revision-specific receipts are in IMPLEMENTATION-STATUS.md and
`deploy/evidence/`. Normal repository publication and pending package audit remain separate gates.

### Installation acceptance priority

The next requested increment exercises kernel-first Kubernetes installation end to end, followed by
public applications only. Verify installer prompts, initial administrator username/password,
composite roles and satellite enrollment with an explicit local-to-container token handoff.
External provider connections are deferred for this baseline. The existing Operations deployment
proves the installed experience, but does not yet certify that complete installer journey.

The first kernel-first/public-only installer acceptance used installer `6eec292` and runtime
`369d96f`, including real desktop password login and state survival across pod replacement.
That initial run exposed missing vendor-import routes. They have since been implemented:
Codex and Claude transfer and actual model requests pass in the local Kubernetes installation
(kernel `f365321`, desktop `6c42c27b`). Antigravity is not certified. The enrolled Operations
worker also completed three real investigation/review phases under source `b8f1df53` and stopped
at human report acceptance. Repeatable worker enrollment and boot-time inference configuration
still need installer integration; the current protected worker does not follow dynamic fleet settings.
See IMPLEMENTATION-STATUS.md for revision-specific boundaries and receipts.


## Pipeline review follow-through — 20 October 2026

See [the source review and service acceptance matrix](PIPELINE-REVIEW.md) and ADR0007.
M1 and L1 are deployed. M2/M3 are partial. M4 is not delivered merely because monitoring exists.
Execute the following in dependency order; do not use a synthetic UI flow as a service acceptance result.

| Work item | Depends on | Completion evidence |
|---|---|---|
| P1 Durable source admission | Native current-caller/background grants, package transactional store | Conflicting IDs, concurrent retries, crash/restart and quarantine tested against the real store. |
| P2 Telemetry and stored queries | P1, bounded durable OTLP storage, pinned percolation backend | Rule publication readiness, all matching pages, error versus no-match and window evaluation. |
| P3 Suppression/reservation | P1/P2, durable atomic reservation and outbox | Established scoped keys and configured windows; 100 occurrences/two workers produce one admitted capture per incident revision. |
| P4 Temporal correlation | P3, scheduled immutable-ID inventory, bounded graph queries | Shared hubs, replacement pods, stale edges, direction and unavailable graph produce explainable results. |
| P5 Anomaly service | P2, actual detector backend, baseline and control datasets | Warm-up, shift/control/seasonal cases, missing samples, tied timestamps and failed-item replay; measured false positives and latency. |
| P6 Conditional evidence | P3/P4/P5, scoped collectors and standard external connections | Packet carries admission decision and every source outcome; investigation worker cannot access the cluster. |
| P7 Canonical action workflow | P6, scoped worker model configuration and Workflow Studio | Investigate/review/revise reach human acceptance; report acceptance is separate from execution authority. |
| P8 External synchronization | P7, shared connector write/webhook primitives | Destination operation ledger, timeout reconciliation and inbound echo prevention; no automatic duplicate sends. |
| P9 Experience acceptance | P1–P8 read projections | Source → decision → incident → packet → ticket/workflow links; unavailable services shown as unavailable. |

Immediate lab increment: measured CPU pressure has generated firing/resolved Alertmanager deliveries;
read-only evidence isolation passed. First workflow attempt failed on a boot-time model default;
its failed ticket is retained. The explicit retry completed investigate/review/revise and reached human report acceptance; live recovery and collector-denial checks pass. Generalized automatic intake,
filtering, reduction, graph correlation and anomaly detection remain unfinished.

### P1 progress: transactional delivery ledger

Source implementation and real PostgreSQL acceptance now cover canonical payload identity,
conflicting reused IDs, per-attempt history, atomic pending-work admission, concurrent replicas,
rollback and uncertain-acknowledgement replay. The Data inspector exposes the attempt outcomes.
Next P1 gates are installed native SQL/migration acceptance, producer principal binding, replay
lineage and background ingestion. P2–P9 and the full M2–M8 acceptance scope remain open.

### Graph source basis confirmed

The operator identified the archived database/load scripts as the starting structure. The three
host/service, AWS and Kubernetes loaders and their node/edge models are now traced in
[GRAPH-STRUCTURE.md](GRAPH-STRUCTURE.md). M3/P4 must retain those entity/relationship families,
replace name-based instance identity and whole-loader freshness stamping, and reconcile complete
scan generations without discarding history on partial failures. This supplements the earlier
query/correlation review; it is not a claim that graph implementation is complete.

### P4 progress: temporal graph and loader implementation

ADR0009 establishes immutable source-owned scans, native scoped SQL storage, bounded historical
reconstruction, affected dependency-path correlation, saved decision evidence and an interactive
Estate graph. `lab/topology.py` translates actual Kubernetes observations without name-based pod
identity or unconditional freshness stamps. Manual Data correlation selects recorded occurrences;
it does not consume pending processing items or dispatch work automatically.

Next gates: installed native migrations/API/browser acceptance; scheduled service-principal
collection; configurable scan cadence; cloud discovery; conflict resolution across sources;
retention/checkpoints; integration after P3 suppression; event-time policy selection and real
replacement/autoscaling acceptance. M3/P4 remains partial until these gates pass.

Native P4 increment acceptance now passes for source `a0066a4b`: actual Kubernetes inventory
loaded through the installed route, durable scan retry/conflict behavior, saved bounded correlation
and the Estate/Data browser journey. See `deploy/evidence/topology.json`. This closes the initial
native migration/API/browser gate for the bounded manual graph, not the remaining P4 delivery gates.

### P2/P3 progress: percolation and transactional suppression

Actual OpenSearch stored-query publication and complete match pagination are implemented with
immutable generations. The Data view publishes a source policy, checks engine health, evaluates
selected recorded alerts and shows rule/reduction receipts. SQL atomically commits decisions,
scoped symptom counts and pre-evidence reservations; policy replay cannot recount the same delivery.

Acceptance covers two independent SQL pools processing 100 occurrences, configured fixed/sliding
boundaries, severity high-water, late states, publication conflicts, failed searches, rollback and
lost acknowledgements. ADR0010 defines the engine and ownership boundaries. Native deployment
and browser acceptance are reported per source revision in IMPLEMENTATION-STATUS.md.

Remaining P2/P3 gates: durable separate OTLP observations and window evaluation, authenticated
background processing, lease/retry/retention policy, and evidence consumers that release/reconcile
failed work. Existing percolation and reduction do not complete P2/P3 or enable automatic healing.

## Immediate workspace and deliverable acceptance

- [x] Restore the standard retained workspace PVC in the native installer and mount the enrolled Kubernetes worker.
- [x] Verify shared bytes survive worker replacement; verify a real synthetic workflow runs through that worker.
- [x] Verify the runtime persists actual accepted artifacts before phase advancement and exposes original-reader downloads in Work Artifacts.
- [x] Verify old accepted reports remain readable after source upgrades while stale execution still refuses.
- [x] Verify approval in the experience uses native confirmation and the returned workflow status (disposable installer ticket).
- [ ] Run a named CLI workflow from an evidence packet without pre-supplied scripts; inspect generated remediation, rollback and verification files on the PVC and in the portal.
- [ ] Obtain exact remediation approval, execute only the admitted action, and record measured recovery against the ticket.

The shared workspace is a standard installation dependency, not a separate Operations
storage design. ADR0011 records that correction. Report approval is distinct from
remediation execution authorization.

## Application navigation acceptance

- [x] Declare Operations destinations and framework exclusions in the application YAML.
- [x] Preserve the application context on canonical ticket links.
- [x] Verify installed global navigation removes absent, inactive and unauthorized application links.
- [x] Verify focused Operations opens its declared default, ticket, topology and pipeline views.

See ADR0012; navigation completion does not close the remaining pipeline gates.

## Graph and processing experience

- [x] Search and filter saved inventory nodes; open observed directed relationships and provenance.
- [x] Display comparable percolation and reduction fractions for the bounded decision cohort.
- [x] Read saved correlation groups and distinguish degraded fallback from observed dependency paths.
- [x] Chain explicit evaluation to correlation of admitted/escalated survivors without automatic dispatch.
- [x] Verify the installed experience with a labeled 100-event cohort and actual Kubernetes inventory.

ADR0013 records cohort boundaries, partial-history limits and the remaining automatic-processing gates.

Installed graph/pipeline acceptance: application `1a02c4ca`, kernel `57abf31`, actual
OpenSearch 3.3.2. One hundred labeled synthetic occurrences produce 30 rule matches,
three surviving symptoms, 27 suppressed duplicates, and two correlation groups through
one observed dependency path. The source inventory contains 18 assets and 32 relationships.
See `deploy/evidence/detection.json`. This completes the manual graph/processing experience
increment; background processing and remediation remain separate open gates.

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

## Kernel baseline editor

ADR0015 restores Code Server as a standard kernel installation dependency, before store
applications. The existing installation is upgraded using the same pinned image and
shared workspace PVC. Acceptance covers a fresh administrator bootstrap, readiness,
portal-to-editor navigation and the actual workflow report, with pod-loopback isolation
independent of NetworkPolicy enforcement. Kernel `deploy/k8s/editor-evidence.json`
records the final deployed revisions and observations. Remote multi-user editor sessions
and full kernel certification remain separate gates.

## Product submission and enterprise pilot — ADR0016

The submission is TriageNorth. The existing OSHAL foundation is a separately
versioned Docker/OCI dependency providing security, workflows, UX, connections and
tickets. Preserve technical package IDs and accurate platform attribution. Use the
product brief, updated proposal, Visio and market research for the hackathon story.

| Deliverable | Acceptance and dependency |
|---|---|
| Product/foundation boundary | Independent image digest and product package revision; dependency credit; fresh container baseline before product install. |
| Competitive and cost research | Six vendor primary sources, observation date, comparable units, explicit exclusions and quote-only unknowns; refresh before a buyer proposal. |
| Analysis hub pilot | Source coverage and reviewer-labeled incidents; measure analyst minutes, missed incidents, evidence quality, accepted proposals and cost per completed investigation. |
| Predictive capability | Separate forecast/anomaly cases; time-separated evaluation with no future leakage, baseline comparison, precision/recall, false alerts per asset-day and warning lead time. No production predictive claim before this gate passes. |
| Responsive behavior | Record p50/p95 by pipeline stage, queue backlog and retry outcomes; current scheduled cadence is minute-scale. |
| Corporate offer | Define application packaging, support, product pricing, registry publication and upgrade/rollback; foundation commercial arrangements are handled separately. |

The pilot is a proposed four-week sequence after integration readiness: baseline and
permissions, shadow analysis, reviewed proposals, then a bounded approved response.
This does not change existing P1–P9 or M2–M8 completion requirements.

Foundation release check: align the native image's license/notice payload and Cargo
metadata with the existing project's documented AGPL-3.0-or-later/commercial model.
The current metadata discrepancy is recorded in MARKET-RESEARCH.md; this documentation
increment changes no licensing files or rights.

## 21 October increment: context before investigation

Accepted under ADR0020/STREAMS-AND-REPLAY.md: three scoped rolling telemetry banks; 900-second minimum-age guard and batch backpressure; explicit OTLP/CloudWatch mappings; independently retained context packets; deterministic non-container scenario through real percolation/reduction/correlation. The BGL recorded-data baseline and bounded logical bank growth also pass. Follow with continuous producer enrollment, NAB anomaly calibration and durable evidence-to-ticket/workflow dispatch. Physical storage autoscaling remains open. Defer paid/real cloud educational environments until the product path and read-only discovery gates are ready.

## 21 October continuation: complete the operating journey

The operator explicitly rejects stopping after replay. Continue through usable percolation editing, actual monitoring configuration, continuous source admission and third-party workload/node fault/patch/recovery scenarios, then connect the canonical workflow/generated artifacts and exact-action recovery path. ADR0021 implements rule editing and candidate trials. The existing live baseline drill has been rerun successfully; it is not the full connected pipeline. OPERATING-GUIDE.md records current controls and will be updated with accepted live commands and evidence. Keep committing/pushing coherent steps while continuing the full goal.

### Connected operating experience acceptance

- 3D temporal explorer: six presets, directed bounded queries, accessible controls, phone and access-withdrawal checks; source implemented, native acceptance next.
- Funnel: retain exact cohort IDs from intake through rules/reduction/correlation and link actual canonical AI workflow/output/approval/recovery records. Unconfigured stages are unavailable, not invented completed counts.
- Ticket files: use the core Work Artifacts folder explorer for accepted workflow outputs and browser downloads. The core **Save to My files** action explicitly copies an admitted accepted artifact into the caller's personal Files, up to 10 MiB; opening My files alone does not copy it. Core ADR193 now projects explicit `file=NAME` sections from a verified accepted answer into the same ticket inventory with producing work, source digest and current-reader admission; installed byte-exact readback is recorded in `deploy/evidence/ticket-named-artifacts-live.json`. Keep the response plan's authenticated store for approval and execution, and do not create another application file store. Future artifact types should use a similarly verified framework contract.
- External records: shared-framework user connections, mapped workflow/provider statuses, durable idempotent outbound attempts, conflict/unknown-result reconciliation and inbound status ownership. Prove Jira/GitLab/Splunk On-Call provider contracts before activating a real destination.
- Shared communication services: import existing configured secrets into kernel custody, enable standard services and grant current-user rights; configuration and live delivery are separate acceptance checks. No external text/call is sent without an authorized destination.

## Current operating handoff dependencies

The installed3D explorer and rule workbench have native password-login acceptance.
The evidence-to-canonical workflow has three genuine completed phases and three
verified shared-PVC files; report approval remains pending. Keep these accepted
behaviors separate from the outstanding automatic producer/remediation loop.

The connection view now distinguishes selected service endpoints, current-user
invocation scope, saved account liveness and registered notification transports.
It reads standing only and never claims delivery from environment key presence.
Core ADR187 supplies the missing standard native HTTP operation handlers; Jira
transition discovery/write, GitLab issue read/state update and ServiceNow incident
state update are included in source. The full kernel gate and rollout precede
real account validation. Durable mappings/outbox, webhook verification, conflict
and echo handling remain required for complete status synchronization. SMS uses
ADR186 and the same rollout dependency; voice retains the existing separate carrier
path. Configuration sends no message and grants no infrastructure authority.

Manual status handoff is source-implemented under ADR0025, with eight focused SQL/browser cases. Native package/schema acceptance follows. Unattended subscription, server-attested outcomes, verified webhooks, GitHub/Splunk adapters and full bidirectional conflict/echo handling remain open. The operator explicitly authorized one SMS, one brief call and one Telegram test; those tests remain pending service rollout.


Installed manual handoff acceptance: application400a15f7, artifact0bab59f358841517f4500c5b3d121ccb865699f74e4e049471fc34a81052b327, passes real password login, owner-scoped empty mapping/attempt reads and shipped refresh controls. No provider issue was mutated. Selected-account Actions and explicitly enabled brief phone alerts are committed in core579c8fd; full final kernel certification/rollout remains pending. The one-time authorized notification runner persists its reservation before each possible send and mutes its test topics; no live acceptance test has yet run. Source fixture corrections8d447c0 preserve strict route and workflow-only assertions;39 focused tests pass.


21 October — local development service acceptance (ADR0026): kernelac5f00e is installed with image/binary digests and a rollback snapshot, preserving the complete pod configuration apart from image/source annotations. The standard installer configures the shared services. Exactly one SMS, one brief phone and one Telegram attempt have transport acceptance, and all test topics are muted. Telegram's older response was reconciled explicitly without a resend; the operator confirmed the phone call. The SMS was subsequently confirmed undelivered with Twilio error30034 (unregistered US A2P sender); Telegram human receipt remains unverified. Native service/handoff controls and all three existing workflow-generated files pass rechecks. Jira invocation scope and selected account are linked, but its read-only profile returns HTTP404; no external issue was changed. Full kernel certification remains open: cache/fixture fixes are committed through af5afcb, and the 264MiB stream expiry remains an unresolved full-gate result. The app milestone is merged as PR543/e0ef6f4f; neither that merge nor local development acceptance certifies the full event-to-action product.

21 October — decision visibility correction (ADR0027): native activity's unmeasured placeholder and list-only workflow view are replaced in core ADR190 by ticket-attributed reference estimates, exact source-checked input lineage, actual bot decisions and a read-only Studio runtime graph. Source UI70checks and estimator unit cases pass; live deployment acceptance remains pending. Specialist/reviewer instructions now demand evidence citations, decision tables and scoped script proposals; existing reports are retained unchanged. Create will be installed as the broader studio shell around the existing AI Office component. Email notices use a dedicated filtered mail catalog; a mailbox connection remains distinct from portal email transport.

## Decision-chain checkpoint — 21 October


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

## Planned increment — Git and Jarvis hierarchy

[H1–H5 promotion roadmap](SWARM-PROMOTION-ROADMAP.md) scopes user-bound Git connections, two-swarm delegation, lower-environment proof, exact-change approval/promotion and independent upper-swarm recovery. ADR0030 is proposed; no hierarchy is deployed. Each milestone has dependencies and acceptance criteria.

### H6 — Response paths and verification

Prototype four response choices and distinct service/change status; implement a durable read-only verification branch after exact-change execution. Dependencies: H1–H4, target-bound authority, change receipts and scoped metrics. Done when all normal/refusal criteria in [RESPONSE-PATH-DESIGN.md](RESPONSE-PATH-DESIGN.md) pass, including missing telemetry, regression, duplicate wake, patch reconciliation and revoked authority. UX prototype is available; runtime implementation remains open.

## Operator backlog — 21 October

1. Ship the Systems tree/detail workbench and consistent native navigation (ADR0032); verify actual captured pod/container status, keyboard use, refresh/refusal and phone layout.
2. Build a cited historical RCA library from canonical tickets, accepted artifacts and original evidence, with explicit report-acceptance versus recovery status. Trace the historical map before adding correlation retrieval.
3. Add a reusable original-user Kubernetes connection and bounded diagnostic/exec service with explicit private endpoint/CA trust, RBAC, exact-target confirmation and terminal transcripts. Pods use API exec; hosts use SSH. Never reuse the public HTTP fence as private-cluster access or hand unrestricted cluster credentials to the analysis bot.
4. Connect selected diagnostics and library references to sealed workflow input; verify the actual AI evidence chain and cost.

Historical RCA read projection (ADR0033) is implemented in source. Next acceptance is the actual installed account catalogue and its original report downloads. Subsequent retrieval must revalidate citation access/digests before adding a case to sealed AI input. Private-cluster diagnosis and pod exec remain the next reusable infrastructure-service gap.

## Selected pod investigation increment

Resource tree and canonical RCA library are installed through the native registry and browser-accepted. Shared kernel source `65ed1926` supplies private-CA Kubernetes inspection/log/exec through an original-user scoped connection. Actual native status, cgroup memory/CPU counters and exact commands pass; secrets and foreign-namespace pod reads return 403, and stale UID execution is refused. Installed browser inspection, exact review and execution also pass. The workbench provides readable health/output, named diagnostics, a visible versioned analyst packet and separately staged AI suggestions. Per-run model and deployment receipts identify the exact checked source; full kernel certification remains separate. Persistent TTY, multiple selected clusters and automatic historical-case admission remain subsequent items with explicit authorization and provenance.

## Scheduled retained evidence — source increment

ADR0035 adds an explicit capture setting to the existing personal evaluation schedule. Reduced reservations now have an atomic retained-packet consumer, bounded retries and source/configuration fences; missing context and non-capture rules remain explicit. Focused SQL/OpenSearch/browser checks exercise the consumer. Native rollout acceptance remains pending. The full delivery audit remains open, including continuous producer admission, correlation, canonical dispatch and exact approved recovery.

## Daily operator UX — implementation checkpoint

ADR0036 reorganizes Operations, Systems, Data pipeline and Sources around attention, selected resources, event decisions and exact source revisions. Source search, pipeline tabs and readable event trails are implemented; existing write controls are preserved. Acceptance completed at `8e259b15`: full Operations suite and normal Store gate, exact package installation, four-screen native inspection and source/event navigation. Receipts are in `deploy/evidence/operator-workspace.json` and `scheduled-capture.json`. This increment does not close the remaining producer, anomaly, automatic workflow, remediation or recovery gates in DELIVERY-AUDIT.md.

Native acceptance follow-up: the selected saved pod exists with the same UID and Running phase in the owned lab, but the user-connection current-status read returned upstream unavailable. Resolve its connection/transport path before claiming live pod-console acceptance; saved-tree UX acceptance is separate.

## Scoped pod connection recovery and compact Systems follow-up

Native application `fd4cb55c` and development kernel `fe10403` are installed. The failed live pod read was traced to a one-hour issuer credential stored without an expiry by the shared manual-connect path. Kernel ADR192 adds manual expiry admission and a standard `pod-connect` installer command; it renews the existing namespace-scoped account under the same portal login. An intentionally shortened local deadline produced `expired` and an actionable HTTP403 refusal; the actual installer then renewed the account with the issuer deadline. Native API and browser current-status reads show the original pod UID Running, container ready and zero restarts; bounded log retrieval completed with no lines. No exec or model request was made. The credential still expires in one hour; automatic renewal is not claimed.

Systems filters now fit one compact desktop row, and searching preserves the observed cluster name without adding filtered resources. Eight focused projection/browser tests pass from the committed export; the normal Store gate reports83pass/0fail/6partial/12named skips. Shared connection tests7, installer24, namespace setup4, secret guard8 and strict workspace Clippy pass. Receipt: [pod connection recovery](../../deploy/evidence/pod-connection-expiry.json). Earlier failed-read receipts remain historical evidence, not current recovery claims. Full kernel certification and the remaining Event-to-Action requirements stay open.
