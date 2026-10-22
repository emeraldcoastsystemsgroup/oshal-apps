# Event-to-Action delivery audit

Updated 21 October 2026 against source and retained native receipts after the operator
resumed Docker and development. The objective remains the entire Event-to-Action
pipeline; a successful replay does not close the remaining product requirements.

**Current runtime: available under supervised development.** The native portal and
TriageNorth are running. New receipts prove separate retained context, minimum-age
rotation, safe growth, an actual standard Collector path and explainable datacenter
replay with saved results. Continuous producer admission, anomaly detection, cloud
discovery, automatic ticket/workflow linkage and provider synchronization remain open.

## Requirement-by-requirement evidence

| ID / requirement | State and authoritative evidence | What still proves completion |
|---|---|---|
| R01 Product experience on the existing foundation | Partial. Native application launch, own-scope permissions and package navigation previously accepted. Product brief/ADR0016 use proposed name TriageNorth; runtime remains `intelligent-operations`. | Complete the remaining connected user journeys; preserve one foundation login and stable package IDs. |
| R02 Problem statement, plan, dependencies, architecture and ADRs | Present. Maintained sources, 21-page editable `.vsdx`, PDF/Word exports and artifact hashes exist. | Current exports and 10-slide PowerPoint are regenerated; native Microsoft Visio editing remains recipient acceptance. No legacy binary `.vsd` was produced. |
| R03 Containerized baseline installer with administrator login | Prior local acceptance. Kernel `deploy/k8s/local-install-evidence.json` and `editor-evidence.json` record kernel-first/public-app-later installation and login. | Correct capacity/placement, repeat clean installation, finish registry/Helm/Terraform publication and full kernel certification. |
| R04 Portal-first satellite enrollment and CLI login | Prior local acceptance in kernel enrollment/account receipts and installation notes. Codex/Claude transfer and real responses verified earlier. | Recheck after safe restart; cloud CLI discovery/evidence scopes and expiry/revoke acceptance remain separate. |
| R05 Shared bot workspace and baseline editor | Prior local acceptance. Kernel `editor-evidence.json` records bound PVC, matching report hashes, browser opening and loopback access. | Budget the co-located services. The operator editor is not a certified per-user remote editor. |
| R06 Office/email/Telegram and needed framework services | Partial. Installed package/grant and Office artifact acceptance recorded in implementation status; Telegram connector configured. | Mailbox login, actual notification production and acknowledged Telegram alert delivery. Configuration alone is insufficient. |
| R07 Standard alert envelopes, required identifiers and admin mapping | Implemented manual path. `src-routes/experience.ts`, `ui/source-contract.js`, `ui/adapter-mapping.js` and intake receipt. | Bind unattended producers to registered source revisions; prove forged/missing identity and revoked source refusal on that path. |
| R08 Durable raw delivery, normalization and delivery deduplication | Prior native acceptance. [intake receipt](../../deploy/evidence/intake.json): 100 requests, one creation, 99 retries, conflict quarantine, persistence and anonymous refusal. | Background admission, replay lineage and stated multi-replica/commit-loss cases. Four HTTP clients were not two kernel replicas. |
| R09 Separate retained OTLP observations and time windows | Partial,21October. Scoped OTLP JSON log/numeric metric banks, exact-resource 15-minute queries, safe growth and real-time packet survival are accepted; `telemetryWindows` identifies this bounded context capability. | Continuous delegated producers, aggregation rules, additional OTLP profiles and anomaly evaluation remain separate. See STREAMS-AND-REPLAY.md. |
| R10 Stored-query percolation and visible decision reasons | Prior native acceptance. [detection receipt](../../deploy/evidence/detection.json): 37 published rules, 36 enabled matches per selected event; backend OpenSearch 3.3.2. | Retention/index lifecycle and integration with the remaining continuous source/window paths; keep failure distinct from no match. |
| R11 Source/type/resource-key noise reduction before enrichment | Prior native acceptance. Detection receipt: 100 occurrences, 30 matched, three admitted symptoms and 27 suppressed duplicates; replay retained counts. | Complete downstream reservation consumption/reconciliation without duplicate capture, investigation or delivery. |
| R12 Automatic processing of recorded alerts | Prior native acceptance. [processing receipt](../../deploy/evidence/processing.json): seven alerts, native scheduled ticks, no manual trigger, 65-second pause/resume, final worker disabled. | Continuous producer → queued work linkage; source authorization remains independently required. |
| R13 Graph explorer and retained topology | Prior native acceptance. [topology receipt](../../deploy/evidence/topology.json): 18 actual assets, 32 relationships, retry/conflict refusal and browser correlation display. | Scheduled inventory, additional asset families/providers and demonstrated update/freshness behavior through the experience. |
| R14 Temporal graph correlation | Partial. Recorded bounded manual correlation and the native 100→40→4→2 dependency replay pass; `topology-store.ts` owns persistence. | Automatic event-time correlation after reduction, stale/degraded graph behavior and preservation of downstream lineage. |
| R15 Periodic Kubernetes/container discovery | Open automated path. [Scoped connection renewal and current pod inspection](../../deploy/evidence/pod-connection-expiry.json) now pass in the native UI after recording the provider expiry; this is an operator read, not scheduled discovery. Real captures/imports exist; topology receipt explicitly has `periodicCollection: false`. | Configurable schedule, scale/replacement/movement, partial scan handling, freshness and provider-scoped collector identity. |
| R16 AWS/Azure/GCP and data-center inventory | Open. Topology/connection prototype is synthetic; API `cloudDiscovery` is false. | Standard identifiers, real scoped scanners, visual network relationships and measured/unknown node health per provider. |
| R17 Conditional bounded evidence packets | Retained-context automatic capture accepted. [Scheduled capture receipt](../../deploy/evidence/scheduled-capture.json): actual personal tick, five synthetic occurrences, one retained packet and matching completion hash; SQL guards cover retries, disable races and ownership. Existing retention receipts prove raw-bank survival. | Additional authorized infrastructure collectors, disappearing-target behavior and automatic incident-revision/workflow linkage remain open. |
| R18 Optional Splunk/external enrichment | Open. Architecture and connection boundary specified. | Authorized bounded connector query, source/time provenance and visible denied/unavailable enrichment without losing the incident. |
| R19 Execution agent uses preprocessed evidence | Prior isolated investigation acceptance. Pressure receipt and `lab/dispatch.py` constrain the model to an admitted packet and supplied proposals. | Preserve this boundary in automatic capture and action paths; hostile-evidence and credential-exclusion acceptance. |
| R20 Canonical ticket and Workflow Studio alignment | Partial. Three actual investigate/review/revise phases reached the human report approval gate; three native shared-workspace downloads matched their stored sizes and hashes. | Durable incident-to-ticket creation/linkage from the automatic pipeline, duplicate/uncertain-create recovery and phase/artifact lineage. |
| R21 Workflow-generated remediation scripts | Open. Existing pressure scripts were supplied inputs; generated reports are not generated remediation. | Workflow persists actual versioned scripts, manifest, validation, verification/rollback instructions and inspectable diffs on the shared PVC. |
| R22 Approval bound to exact work and targets | Open end-to-end gate. Original pressure report remains `awaiting_approval`; report acceptance is not execution approval. | Artifact digest, target, principal and expiry binding; changed values and withdrawn authority invalidate execution. |
| R23 Registered bounded action and verified recovery | Open. Pressure receipt has `infrastructureExecutedByAgent: false`. | One-time authorized action, cancellation/revoke, bounded outputs, failed postcheck behavior and durable matching recovery receipt. No self-healing claim. |
| R24 ServiceNow/GitHub/GitLab/Jira synchronization | Open end-to-end. API `ticketSync` remains false. Standard native HTTP handlers and Jira/GitLab/ServiceNow state operations are source-implemented under core ADR187. ADR0025 adds a manual snapshot handoff, reserved attempts and operator-reported readback. Full kernel gate, rollout and installed acceptance are pending. | All four providers: operation/webhook coverage, field ownership, scoped connections, idempotency, outbox, uncertain-result reconciliation and loop/conflict handling. |
| R25 Anomaly detection and predictive analysis | Open. Archive result consumers are not a detector; API `anomalyDetection` is false. | Actual baseline/detector, cold start, control/shift/seasonal cases, stable cursors, precision/recall, false-alert rate and lead-time results. |
| R26 Pipeline/data UX and correlation results | Follow-up `fd4cb55c` keeps embedded filters compact and filtered cluster names stable; [native current pod status and log reads](../../deploy/evidence/pod-connection-expiry.json) pass after the shared expiry repair. [Native operator workspace](../../deploy/evidence/operator-workspace.json) adds a consistent attention overview, resource workbench, source mappings and pipeline tabs with event decision trails. Current native replay: 100 → 40 → 4 → 2, actual dependency cards, four packets and saved cohort reopening. Earlier graph cohort 100 → 30 → 3 → 2 remains a separate receipt. | Extend those real links through packet, workflow artifact, external ticket, approval, execution and recovery; no fabricated counters. |
| R27 Bounded pressure/noise demonstration | Prior manual lab acceptance. Real CPU signal fired/resolved and collector restrictions passed; synthetic labeling retained. | A new safe CPU-only run covering every arrow of the completed pipeline without hidden operator calls. No GPU or host-memory exhaustion testing. |
| R28 Research, commercial framing and foundation attribution | Present in brief, market research and ADR0016. Original foundation references document AGPL/commercial licensing; native metadata mismatch recorded. | Reconcile actual release metadata/notices before publication; substantiate pilot economics with measured results. No employer/IP determination is part of the application. |
| R29 Source delivery and verification | Current application increments are committed and pushed to the existing feature branch through normal hooks. The complete Operations suite passes, with eleven clean-export checks at 3155da06 for navigation/topology and three final correction UI tests at 8e259b15. Full Store: 83 passing checks, zero failures, six partial suites, twelve named unavailable prerequisites. | Complete outstanding release prerequisites and full product/kernel certification; partial/skipped suites are not passed claims. |

## Build order and acceptance dependencies

The operator has resumed runtime work and the local startup/placement checks pass.
Preserve the full P1–P9 and M2–M8 requirements in PROJECT-PLAN.md:

1. Complete producer-bound admission and separate OTLP persistence/window evaluation
   on the existing native authority and connection framework (R07–R09).
2. Complete scheduled inventory, automatic correlation and detector integration
   while retaining explainable decisions and source/freshness evidence (R10–R16, R25).
3. Consume conditional evidence reservations, assemble bounded packets and create
   or reconcile the canonical workflow ticket (R17–R20).
4. Have the workflow generate actual remediation artifacts; bind human approval
   before a registered action and observed recovery (R21–R23).
5. Complete provider synchronization/notifications and connected UX; verify all four
   requested ticket providers, not merely the first disposable demonstration
   (R06, R18, R24, R26).
6. Repeat the full CPU-only demonstration, installation and normal publication
   checks; reconcile artifacts and the final completion audit (R02–R05, R27–R29).

## Evidence interpretation

Source fixtures, historical receipts, current service availability and live-provider
acceptance are separate claims. The pressure receipt's old filtering/correlation
limitations describe that particular run; later detection receipts establish those
later increments without retroactively turning the pressure run into an automatic
pipeline. Likewise, scheduled queue draining does not prove unattended collection,
correlation, evidence collection, ticket creation or remediation.

This audit found unfinished requirements; it does not certify the goal complete.
