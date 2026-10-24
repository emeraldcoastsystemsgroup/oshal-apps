# TriageNorth hackathon submission

Updated 23 October 2026. TriageNorth is the proposed product name: **From signals to evidence to action.**
OSHAL is the existing platform foundation, installed separately as a Docker/OCI baseline. Its security, workflow, UX, connection and ticket services support the submitted application. Technical package/API IDs remain `intelligent-operations`.
This documentation directory contains design drawings, maintained delivery records and generated submission artifacts; application installation uses the separate native package flow. The editable Visio deliverable is modern `.vsdx`; no legacy binary `.vsd` export is claimed.

**The native application is running under supervised development.** Start with the
[Scenario lab](http://127.0.0.1:38081/api/intelligent-operations/app#replay): saved
results show 100 synthetic occurrences → 40 matches → four symptoms → two dependency
groups, with four pinned packets. [Live context](http://127.0.0.1:38081/api/intelligent-operations/app#streams)
shows exact source mappings and protected bank counters.

The [fresh decision-chain receipt](../../deploy/evidence/decision-chain.json)
records eight actual monitoring observations from a synthetic local failure,
three completed analysis phases, exact admitted inputs, shared-workspace report
hashes, reference-cost estimates and the read-only Workflow Studio graph.
[Create](http://127.0.0.1:38081/cockpit/?app=create) is installed alongside Office;
[Email & mailboxes](http://127.0.0.1:38081/utilities?category=email) exposes Gmail
and Outlook. Human report approval and actual mailbox/notification delivery remain
separate gates.

**Every feature, its status and its proof are in the [feature catalog](FEATURES.md).** New on
23 October:

- **Ops console:** ask in plain words or type kubectl. Each command runs through your own
  connection, prints its result, and is assessed and explained.
- **Git explorer:** compact, with GitHub live and GitLab ready.
- **Cloud clusters:** EKS, GKE and AKS inventory, plus Azure machines and networks.
- **Look and layout:** a glass look across the app and a narrow-screen layout.
- **Live GitHub promotion:** accepted on the lab.

The [delivery audit](DELIVERY-AUDIT.md) separates demonstrated behavior from the full
remaining product scope. The [resource review](RESOURCE-REVIEW.md) retains historical
shutdown findings and current local startup limits. The overnight heartbeat remains
paused. [Export status](EXPORT-STATUS.md) records the refreshed PowerPoint/Word/PDF/Visio
artifacts and their validation; the earlier export hold is superseded.

[Demonstration path](DEMO.md) is the twelve-minute walk-through for judges, each step tied to
its receipt. [Kernel rails needed](KERNEL-RAILS-NEEDED.md) lists, per remaining ask (cloud CLI execution,
SSH, live cluster listing, git promotion, swarm-to-swarm, automatic dispatch), what exists, what
the kernel must add and what the package already does. [Workflow alignment](WORKFLOW-ALIGNMENT.md) maps the Studio definition, the manifest workflow and
the canonical ticket graph onto each other and lists every external integration point with its
authority and state. [ADR0037](adr/0037-approved-response-and-verified-recovery.md) is the response
stage after the human gate.

The [project plan](PROJECT-PLAN.md) lists milestones, dependencies and acceptance gates
([PDF](operations-project-plan.pdf), [Word](operations-project-plan.docx)).
[Implementation status](IMPLEMENTATION-STATUS.md) records what is actually built and tested.

The [three-week improvement plan](THREE-WEEK-PLAN.md) prioritizes real dataset
evaluation, bounded local analysis, replay/topology polish and the presentation
package. A [pinned pilot dataset receipt](evaluation-data.json) records four
prepared series. A separate measured BGL percolation baseline is now available;
NAB anomaly/model evaluation remains open.

The new [Systems view](SYSTEMS.md) brings observed Kubernetes and other recorded
resources into a filterable investigation view with relationships and related
alerts. Source, twelve focused checks and package installation/publication are
complete; a separate live two-user Systems browser acceptance remains open. The three-week plan now includes cross-environment
troubleshooting scenarios and a failure-to-regression learning cycle.

The [interactive UX prototype](../../prototype/README.md) covers incident evidence, estate context,
source setup, connection/CLI identity, approval review and work delivery. It uses synthetic data and sends no service requests.

[Connections, CLI sessions and topology](CONNECTIONS-AND-TOPOLOGY.md) details provider identity,
runner boundaries, per-capability probes and temporal discovery requirements.

[Architecture decision log](DECISIONS.md) tracks ADRs 0001–0027, open decisions and release gates
([PDF](operations-decisions.pdf), [Word](operations-decisions.docx)); individual records are in `adr/`.

[Pipeline source review and gaps](PIPELINE-REVIEW.md) distinguishes implemented behavior from required service acceptance.
The delivery audit reconciles these stages against current source and historical receipts;
older dated entries remain historical evidence, not current service availability.

## Submission and business case

- [Product brief](PRODUCT-BRIEF.md), [PDF](triagenorth-brief.pdf) and [Word](triagenorth-brief.docx).
- [Competitive research and cost model](MARKET-RESEARCH.md), [PDF](triagenorth-market-research.pdf) and [Word](triagenorth-market-research.docx).
- Six primary-source vendor comparisons, clearly scoped price examples, buyer hypothesis, pilot metrics and commercial dependencies. Predictive behavior remains a measured acceptance gate.

## Review documents

- [Problem statement PDF](problem-statement.pdf) and [editable Word version](problem-statement.docx).
- [Complete proposal PDF](operations-proposal.pdf), [editable Word version](operations-proposal.docx), and [maintained source](proposal.md).
- [Editable Visio solution](operations-solution.vsdx) and [diagram PDF](operations-solution.pdf).

The proposal covers the data center model, standards, source identity and mapping,
cloud and container discovery, temporal inventory and graph correlation, noise reduction,
evidence capture, optional external enrichment, application navigation, credentials,
granular access, automation approval, generated code delivery and verified execution.
It distinguishes complete product coverage from the proposed hackathon demonstration.

## Diagram pages

The Visio drawing contains fourteen pages with native editable shapes, text and connectors.
It is not a bitmap inserted into a Visio wrapper.

| Page | Subject | SVG preview |
|---|---|---|
| 1 | Solution architecture and application boundary | [Solution](previews/01-solution.svg) |
| 2 | Data center and cloud topology | [Estate](previews/02-estate.svg) |
| 3 | Processing, durable records and information packets | [Pipeline](previews/03-pipeline.svg) |
| 4 | Approval, delegation and execution authority | [Authority](previews/04-authority.svg) |
| 5 | Application overview and topology preview | [Overview](previews/05-overview.svg) |
| 6 | Credentials, connection scope and identifier mapping | [Setup](previews/06-setup.svg) |
| 7 | Incident evidence, proposed work and exact approval | [Incident](previews/07-incident.svg) |
| 8 | Generated files, validation, execution and receipts | [Delivery](previews/08-delivery.svg) |
| 9 | Data, filtering, deduplication and decision inspection | [Data decisions](previews/09-data-decisions.svg) |
| 10 | Inbound alerts and standard external ticket synchronization | [Integrations](previews/10-integrations.svg) |
| 11 | OSHAL user-bound connections, CLI and runner authority | [Connections](previews/11-connections.svg) |

| 12 | Separate anomaly detection, durable cursors and reduction before enrichment | [Detection](previews/12-detection.svg) |
| 13 | Implemented temporal graph structure and remaining delivery gates | [Temporal graph](previews/13-temporal-graph.svg) |
| 14 | Three-bank protected context and durable packet retention | [Retained context](previews/14-retained-context.svg) |

## Rebuild

Use Python 3 with `python-docx` and `reportlab` installed and the DejaVu Sans fonts
under `/usr/share/fonts/truetype/dejavu`. The builder uses local files only.

```bash
python3 intelligent-operations/docs/event-to-action/build_design.py
```

Use `--plan-only` to refresh the project plan exports without changing design drawings,
or `--manifest-only` to update hashes after documentation-only status changes.

The builder generates the Word and PDF documents, Visio drawing, SVG previews and
`build-manifest.json` with artifact hashes. Layout checks refuse overflowing text,
off-page shapes, invalid connector references, broken XML and a corrupt ZIP package.
PDF and Word are parallel exports of `proposal.md`; the diagram exports share the
same scene definitions in `build_design.py`.

Visio compatibility is checked with ZIP/XML/connector validation and independently
by importing the package through LibreOffice Draw. The fourteen-page export was independently imported, with retention-page text and page count verified. Microsoft
Visio itself is not available on this host, so native Visio desktop editing remains
an acceptance check for the recipient.

All infrastructure, IDs, users, counts and screen outcomes in the diagrams are
illustrative. Proposed capabilities are not deployment or live-provider claims.

- [Retained streams, datasets and Scenario lab](STREAMS-AND-REPLAY.md)
- [ADR0020: three-bank context](adr/0020-three-bank-context-and-standard-streams.md)

Submission artifacts: [demo PowerPoint](triagenorth-demo.pptx), [context/replay Word guide](triagenorth-context-replay.docx), [context/replay PDF](triagenorth-context-replay.pdf), [editable14-page Visio](operations-solution.vsdx).

- [Git and Jarvis-to-Jarvis promotion roadmap](SWARM-PROMOTION-ROADMAP.md): H1–H5 proposed scope and acceptance.

- [Response paths and watcher design](RESPONSE-PATH-DESIGN.md): proposed emergency/standard routes and four interactive mockup screens.

- [Historical RCA reference library](RCA-LIBRARY.md): canonical sources, citations, current limits and planned retrieval.

- [Pod investigation console](POD-CONSOLE.md): selected status, logs, command review and AI evidence boundaries.

- Editable Visio and matching diagram previews now include the pod workbench and canonical RCA reference paths. Generated page/shape/connector counts and artifact hashes are in build-manifest.json.
- [Pod workbench guide](operations-pod-workbench.pdf) and [RCA library guide](operations-rca-library.pdf) have matching Word exports.
