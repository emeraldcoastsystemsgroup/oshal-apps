# Operations architecture decision log

Updated 21 October 2026. Accepted means the product/architecture direction was explicitly established
in this project conversation; it does not mean the capability is implemented, audited or installed.
Each accepted ADR is versioned in Git. A changed decision gets a new ADR that names what it supersedes.
Implementation evidence stays in IMPLEMENTATION-STATUS.md and the milestone gates.

Current runtime: the operator resumed Docker and development on 21 October.
The native application runs with explicit local node budgets and current-user grants.
The overnight heartbeat remains paused. ADR0017 retains the historical restriction;
RESOURCE-REVIEW.md records the supervised resumption. Word/PDF exports are refreshed;
see EXPORT-STATUS.md. Full unattended pipeline acceptance remains open.

| ADR | Decision | Status | Delivery gate |
|---|---|---|---|
| 0001 | An OSHAL experience slice inside the existing Intelligent Operations package; one OSHAL login, standard connections and canonical tickets. | Accepted design | M1 native experience and local current-caller acceptance passed; background source activation remains M2. |
| 0002 | Expose raw deliveries, separate OTLP observations and durable explanations of filtering, delivery deduplication, symptom reduction and correlation. | Accepted design | M2/M4; established algorithm and stored-query/window backend acceptance. |
| 0003 | Synchronize linked ServiceNow, GitHub, GitLab and Jira records through the standard connector framework with explicit field ownership and guarded writes. | Accepted design | M5b; shared operation/webhook gaps must be completed before live activation. |
| 0004 | Reuse user-bound OSHAL connections for CLI tools, discovery and evidence; explicit scoped activation for unattended work. | Accepted design | M2/M3/M7; wrong identity, expiry, revocation and no-default-fallback acceptance. |
| 0005 | Deploy a persistent native OSHAL experience in the isolated Kubernetes lab; authenticated manual captures precede continuous source activation. | Implemented first increment | Native login/roles, captures and persistence; fresh kernel-first/public-only installation and desktop portal login verified. Codex/Claude transfer subsequently verified; see ADR0006. |
| 0006 | Select independent Operations, Office and email applications with built-in Jarvis; configure Telegram on the shared notification rail. | Partially delivered | Package/access and real account/Office acceptance; mailbox sign-in and actual external alert delivery remain separate gates. |
| 0007 | Durable reduction before enrichment; a separate anomaly detector feeds the same decision pipeline. | Accepted design | Source review complete for the named stages; distributed services and detector acceptance remain open. |

| 0008 | Reuse the reviewed host/service, cloud network and Kubernetes topology structure with scoped native identities and completed scan generations. | Accepted design | M3/P4; source trace in GRAPH-STRUCTURE.md, bounded native temporal graph and replay correlation accepted; scheduled inventory remains open. |

## ADR records

- adr/0001-oshal-experience-slice.md
- adr/0002-explainable-event-decisions.md
- adr/0003-standard-ticket-synchronization.md
- adr/0004-user-bound-tool-connections.md
- adr/0005-native-kubernetes-first-increment.md
- adr/0006-hackathon-communications-baseline.md
- adr/0007-durable-pipeline-and-anomaly-boundaries.md
- adr/0008-source-derived-temporal-topology.md

## Open decisions and release constraints

| Item | State and next action |
|---|---|
| Hackathon date and provider accounts | Three-week improvement horizon supplied; exact submission date and provider accounts remain unconfirmed. Priorities are in THREE-WEEK-PLAN.md. |
| First live ticket-sync provider | Select after native connector capability and disposable-account acceptance; all four remain target coverage. |
| Production-grade source identity and app store | Native person-scoped store and imports verified; transactional delivery ledger accepted; background source authentication remains required. |
| Exact native approval/runner coverage | Verify admitted artifact, target, principal and expiry binding before execution. |
| Demo remediation action | Still requires an explicitly scoped registered action; current demo bundle only checks readiness. |
| Provider operation gaps | Shared-framework work, not private app adapters. Source declarations alone do not prove runtime availability. |
| Release/publication | Source published through normal gate: 83 pass, 0 fail, 6 partial and 12 explicit prerequisite skips. First-increment installation verified; package audit and full kernel certification remain pending. |

## Review and change process

Record the decision, reason, alternatives rejected, consequences, owner boundary and acceptance in an
ADR before implementing a changed architectural boundary. Link work to the ADR and milestone.
Update plan, proposal, Visio, exported documents and traceability when the intended experience changes.
Keep simulated UX acceptance distinct from native and live-provider acceptance. Never mark a decision
implemented merely because its mockup or document was created.

- [ADR0009 — Native temporal graph journal](adr/0009-native-temporal-graph-journal.md): implement the reviewed structure on caller-scoped SQL with immutable scans, bounded reconstruction and recorded correlation evidence.

- [ADR0010 — Immutable percolation and reservation](adr/0010-immutable-percolation-and-reservation.md): actual stored-query matching precedes transactional symptom counts and evidence-work reservation through the existing native engine relay.

- [ADR0011 — Standard workspace and workflow artifacts](adr/0011-standard-workspace-and-workflow-artifacts.md): restore the existing shared PVC installation contract; workflow-generated files remain distinct from supplied script inputs and report approval from execution.

- [ADR 0012 — Application-defined cockpit navigation](adr/0012-admitted-application-toolbar.md)

- [ADR 0013 — Inspectable graph and processing cohorts](adr/0013-inspectable-processing-and-graph.md)

- [ADR0014 — Native background processing](adr/0014-native-background-processing.md)

- [ADR0015 — Baseline workspace editor](adr/0015-baseline-workspace-editor.md)

- [ADR0016 — Product and foundation boundary](adr/0016-product-and-foundation-boundary.md): TriageNorth is the submission; inherited platform services remain attributed dependencies.

- [ADR0017 — Local runtime resource gate](adr/0017-local-runtime-resource-gate.md): record the original runtime stop and host/node/workspace budget boundary. Kernel capacity fixtures pass; supervised startup now passes the local placement/reserve checks. A complete production resource profile remains open.

- [ADR0018 — Replay evaluation and bounded local analysis](adr/0018-replay-evaluation-and-local-analysis.md): freeze dataset/rule provenance and independent evaluation, compare statistical baselines and small local models, and retain deterministic source identity and approval boundaries. Dataset preparation, the BGL percolation baseline and native Scenario lab are complete; NAB anomaly/model evaluation remains open.

- [ADR0019 — Observed Systems experience](adr/0019-observed-systems-experience.md): reuse the current user's inventory graph and event page for Kubernetes and other system inspection. Exact identities, historical health and partial observations remain visible. Source, twelve focused checks and package deployment/publication are complete; separate Systems-specific live two-user browser acceptance remains open.

- [ADR0020 — Retained context](adr/0020-three-bank-context-and-standard-streams.md): three logical context banks, minimum-age rotation, safe growth, standard stream mappings and durable preprocessed packets. Native replay, actual 909.788-second retention/packet survival and temporary standard Collector export are accepted. Saved receipts reopen without rerunning events; continuous delegated producers remain open.

- [ADR0021 — Percolation rule workbench](adr/0021-percolation-rule-workbench.md): edit rules/window/capture choices, trial saved candidates without changing active incident state, and explicitly activate against the loaded source revision. Source-focused SQL/OpenSearch/browser checks pass; native rollout follows.

| 0022 | Bounded 3D snapshot explorer and predefined operational graph queries; existing current-user topology authority. | Implemented/browser tested; native acceptance pending | [ADR0022](adr/0022-bounded-3d-snapshot-explorer.md). |

| 0023 | Bind preprocessed evidence reservations to canonical original-owner workflows and count actual native outputs separately from recovery. | Source and isolated browser/SQL tested; native pending | [ADR0023](adr/0023-preprocessed-canonical-investigations.md). |

- [ADR0024](adr/0024-shared-service-standing.md): show native service selection, personal invocation standing and registered notification routes separately; never infer delivery from credentials or configuration.

- [ADR0025](adr/0025-manual-workflow-ticket-handoff.md): immutable own workflow links, reviewed confirmed pushes, durable unknown-outcome holds and explicitly operator-reported readback.


- Communications acceptance reuses the shared native notifier (core ADR188), with separate original-person SMS/voice addresses and an explicit default-off brief-call flag. A durable operator acceptance ledger reserves before sending, holds unknown outcomes and prevents a repeated test from the same approval. Provider acceptance and human receipt remain separate claims; the one-SMS/one-brief-call/one-Telegram approval does not enable general automatic notifications.


- [ADR0026](adr/0026-local-service-acceptance.md): record three one-time transport tests, muted routes, explicit legacy-response reconciliation, source-pinned local development deployment and the distinction from outstanding full kernel certification/live Jira validation.

- [ADR0027 — Visible decision chain](adr/0027-visible-decision-chain.md): exact admitted inputs, named bot handoffs, graphical ticket progress, reference cost and Create/mail entry journeys; installed UI acceptance passed, fresh monitoring investigation and linked deadline retry tracked separately.

- [ADR0028](adr/0028-inline-bot-permissions.md): declare the Operations conversational bot bindings under existing own-scope read permission; verify Jarvis separately from HTTP and native queued-work acceptance.

- [ADR0029](adr/0029-create-suite-and-native-report-artifacts.md): install Create's declared Video, Publishing and PDF components; retain exact private scratch permissions and distinguish actual native exports/provider acceptance from an automatic report chain.

## ADR0030 — Git-backed Jarvis promotion (proposed)

[ADR0030](adr/0030-jarvis-delegation-and-git-promotion.md) and [H1–H5 roadmap](SWARM-PROMOTION-ROADMAP.md) define lower-environment validation and separately authorized upper-environment promotion. This is roadmap scope, not installed functionality.

## ADR0031 — Response paths and sustained verification (proposed)

[ADR0031](adr/0031-response-paths-and-verification-branch.md) separates fast mitigation from permanent repair, preserves a Git-backed expedited path and defines a bounded workflow verification branch. Four-screen mockups use only synthetic data.

## ADR0032 — Operator resource workbench

[ADR0032](adr/0032-operator-resource-workbench.md) replaces repeated Systems cards with an exact-identity tree/detail view and gives the native cockpit sole navigation ownership when embedded. Source checks pass; installation acceptance is tracked separately.

## ADR0033 — Historical RCA references

[ADR0033](adr/0033-canonical-rca-reference-library.md) adds a current-user read projection of canonical reports and their source citations. It does not infer recovery or establish an automatic case-correlation index.

- [ADR0034: Selected pod command console](adr/0034-selected-pod-command-console.md) — shared original-user transport; application review and bounded evidence analysis.

- [ADR0035: Scheduled retained evidence](adr/0035-scheduled-retained-evidence.md) — explicit capture opt-in, atomic packet completion and bounded retries on the existing personal schedule.

- [ADR0036: Operator screen hierarchy](adr/0036-operator-screen-hierarchy.md) — consistent Overview, Systems, pipeline views and source selection, using existing native navigation and authority.
