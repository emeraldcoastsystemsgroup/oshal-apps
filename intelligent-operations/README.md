# Intelligent Operations

Operations runs as an OSHAL experience slice. The first Kubernetes deployment uses native sign-in and roles, saved source mappings, durable alert records, historical pod/container topology and current-user connection status. See the [deployment and acceptance guide](deploy/README.md).
It uses the existing root-cause-analysis pipeline. File an incident as a ticket of type
`intelligent-operations`; three phases run:

1. **investigate** (`ops-rca-specialist`): classifies the incident (A remediation, B info-request,
   C escalate), states one root cause, the impact, and operator-run remediation or evidence
   collection steps.
2. **review** (`ops-incident-reviewer`): `approved`, `needs_revision` or `escalate`, with numbered
   findings.
3. **revise** (`ops-rca-specialist`): fixes the reviewer's findings.

Nothing is applied automatically. Remediation commands are proposals for an operator to run.

## On the native kernel

- The platform's reviewer loop (`reviewerBot: queue-bot`, `maxRevisions: 2`) is written out as the
  explicit phases above; one revision round runs.
- The bots reason over the ticket and its attachments only. The platform's runbook corpus
  (`infra-runbooks`), the graph tier and shell access are not available to a native bot, so paste
  the evidence you have into the ticket.
- The Operations experience opens at `/api/ui/experiences/intelligent-operations/open`. Native `reader` and `operator` grants control access; records are scoped to the signed-in person.
- The incident workspace remains at `/apps/intelligent-operations/ui/index.html`.
  Overview and Incident tickets read the caller's authorized native ticket projection for Operations
  and Processing. Similar titles remain separate tickets. A finished workflow is not proof of recovery.
- The older incident workspace Source preview checks the draft JSON alert profile and explicit adapter field mappings entirely
  in the browser. Mapping errors block the preview; source and event ID remain envelope fields. It sends and saves
  nothing, does not authenticate a source, and does not resolve an asset or ingest an event.
- The experience saves immutable source/mapping revisions, original and normalized alerts with validation reasons, and timestamped Kubernetes captures. Exact payload retries reuse their record.
- Automated source intake, continuous discovery, the established reduction algorithm, durable OTLP data, external ticket synchronization and infrastructure execution remain planned. Captured topology is historical, with explicit readiness and unknown states.
- It replaces Issue RCA and Incident Remediation, which the platform unified into it (the header of
  the platform's `swarm-apps/intelligent-operations.yaml`). SAP Incident is not part of it, and it
  is not yet ported, so it stays turned off. Its manifest (`swarm-apps-incident/sap-incident.yaml`)
  and its `sap-rca-specialist` persona are in the archived core trunk at commit `41da137`, not in
  the current platform tree or either store. That persona grounds every claim in the `sap-runbooks`
  corpus, which an operator populated from SAP documentation; it is not one of the knowledge
  collections this installation searches. It also searched that corpus and the web from a shell.
  Until it is ported, file SAP incidents here.
  Intelligent Processing builds its alert queue on this application's bots.

## Event to action delivery

The [project plan](docs/event-to-action/PROJECT-PLAN.md) defines milestones, dependencies,
test scenarios and acceptance. [Implementation status](docs/event-to-action/IMPLEMENTATION-STATUS.md)
records actual progress separately from the [design proposal and Visio drawing](docs/event-to-action/README.md).
The [local Kubernetes lab](lab/README.md) provides disposable services, monitoring and bounded noise scenarios.
The [alert profile](contracts/README.md) describes the local source preview and its limits.
The separate [interactive UX prototype](prototype/README.md) explores the full proposed journey
with synthetic data, including data decisions, topology, user-bound tool connections, external ticket
synchronization, scoped access, partial packets and invalidated approvals.
The [ADR log](docs/event-to-action/DECISIONS.md) records accepted architecture choices and open gates.

Run the foundation contracts from the store root:

```bash
node --test intelligent-operations/tests/package-contract.test.cjs intelligent-operations/tests/source-contract.test.cjs intelligent-operations/tests/surface-browser.test.cjs
```

The browser contract requires Chromium and the pinned store toolchain. It serves the shipped
assets with explicit loopback ticket fixtures; it does not certify installed kernel authorization
or provider access. All foundation suites are registered in Test Lab and the store CI command.

<!-- oshal-rating:start -->
## Models and requirements

Generated from this package's `rating:` block by `node scripts/ai-usage-ledger.mjs --write`; do not edit by hand.
The rules behind each field are in the store root `AI-USAGE-LEDGER.md` and core ADR-170.

Container memory, MiB low / high: **192 / 768 (declared)**.

| Feature | Unit | Tier | Generation | Degrade | Tokens per unit | Models verified |
|---|---|---|---|---|---|---|
| incident-rca | incident ticket | T3 | none | disable | not yet measured | none recorded |
<!-- oshal-rating:end -->

New manual imports commit a delivery, attempt and pending processing item atomically. The source
URI and event ID identify a delivery; changed content under that identity is a visible conflict.
Data & decisions exposes attempts and preserves historical imports separately. Background
collection, symptom suppression and automatic action are not enabled by this intake increment.

Run the complete package contracts with `node --test intelligent-operations/tests/*.test.cjs`.
The SQL cases require `OSHAL_TEST_POSTGRES` pointing to a disposable PostgreSQL instance on
`127.0.0.1:35689` and the pinned `scripts/toolchain` dependencies/Chromium. They create isolated
fixture databases and roles; production database endpoints are refused. See implementation status
for the separate source-test and native-installation evidence.

## Graph and processing inspection

Open `/cockpit/?app=intelligent-operations` for the YAML-defined Operations toolbar.
Graph explorer searches recorded source-owned nodes and opens their directed neighbors.
Data pipeline shows the latest returned evaluation cohort passing stored rules and noise
reduction, with event drill-downs and persisted correlation groups. The combined action
correlates admitted/escalated survivors; degraded graph evidence is explicitly labeled.
These are bounded manual evaluations, not continuous ingestion or automated healing.
See [ADR0013](docs/event-to-action/adr/0013-inspectable-processing-and-graph.md).

Background evaluation is opt-in per saved source revision with a published policy.
Use Data pipeline → Background processing to save the source selection and activate
its native personal schedule. Disabling processing fences in-flight decision commits;
failed work receives bounded retries and an explicit recovery action. See
[ADR0014](docs/event-to-action/adr/0014-native-background-processing.md). Source tests and local native scheduled-run/pause/resume acceptance pass.
See implementation status for the exact source and runtime evidence.

The [daily operator guide](docs/event-to-action/OPERATOR-WORKSPACE.md) explains Operations attention, the Systems tree, pipeline tabs, source mappings and bounded-data labels.
