# Workflow Studio, the canonical ticket and the integration points

Recorded 22 October 2026 against the owned lab portal (kernel fe10403, Operations source on
`codex/triagenorth-live-operations`). This describes what is published and wired today; it is not
a claim that every integration ran unattended.

## One workflow, three views of it

| Where | Identity | Shape |
|---|---|---|
| Package manifest (`oshal-app.yaml`) | `ticketType: intelligent-operations`, workflow "Intelligent Operations RCA Pipeline" | phases `investigate` (ops-rca-specialist) → `review` (ops-incident-reviewer) → `revise` (ops-rca-specialist) → `queue-deliver` (`action: complete`, `approval: {approver: admin}`) |
| Workflow Studio (`/workflow-studio/`, definition `intelligent-operations`, version 3) | `runtimeQueue.ticketType = intelligent-operations`, runtime revision `2655e0cd…` | nodes `queue-start` (start) → `investigate` → `review` → `revise` (execute-agent) → `approve-proposal` (approval-gate) → `queue-deliver` (deliver); five edges |
| Canonical ticket (`GET /tickets/{id}/workflow`) | `workflow.id = intelligent-operations:intelligent-operations` | nodeGraph `investigate` → `review` → `revise` → `queue-deliver`, each node `capabilities: []`; the gate is `approval: {approver: admin}` on `queue-deliver`; the ticket stops at `awaiting_approval` on that node |

The Studio graph and the ticket graph are the same workflow: the Studio's explicit `queue-start`
and `approve-proposal` nodes are the kernel's implicit start and the approval attached to the
terminal `queue-deliver` phase. Workflow Studio stays design-time and read-only here; the runtime
(queue manager plus the manifest) remains the authority. The Operations toolbar links Workflow
Studio, and the ticket's Workflow tab renders the native projection (kernel UI 8161399).

## Where the response stage sits

The approval gate accepts the report; it does not run anything (ADR0011). The response stage
(ADR0037) starts from the accepted answer of the `revise` phase and lives outside the workflow
graph, because the kernel exposes no package port to add executable nodes or ticket artifacts:

```
alert → filter/reduce → evidence packet → ticket (investigate → review → revise)
      → human gate (report) ──► response plan (generated files, observed target)
      → exact-artifact approval → one confirmed pod exec → verify.sh + resolved signal
      → canonical approve (ticket done) → optional external issue status push
```

Each arrow after the gate has a durable own-scope record and a download (artifacts, receipt).

## Integration points with external systems

| Direction | System | Rail | Authority | State |
|---|---|---|---|---|
| Inbound | Alertmanager / CloudEvents alerts | `POST /api/intelligent-operations/events` and `/events/batch`, source revision bound | caller's `records.write` | manual and lab-imported; unattended producer binding open (R07) |
| Inbound | OTLP logs/metrics, CloudWatch | `/streams/{source}/v1/logs`, `/v1/metrics`, `/cloudwatch` | caller's `records.write` | implemented; continuous delegated producers open (R09) |
| Inbound | Kubernetes inventory | `/topology/scans` (lab `topology.py`), `/inventory` | caller's `records.write` | manual capture; scheduled discovery open (R15) |
| Outbound | Kubernetes pod status / logs / exec | kernel `/connectors/kubernetes/actions/{op}?account=…` with `x-oshal-confirm` | person's own namespace-scoped connection (ADR191/192) | implemented; used by the pod console (ADR0034) and the response stage (ADR0037) |
| Outbound | Jira / GitLab / ServiceNow issue status | kernel `/connectors/{provider}/actions/{op}?account=…` | person's own connection, manual snapshot plan (ADR0025) | implemented, operator-reported readback; automatic outbox/webhooks open (R24) |
| Outbound | Telegram / mailbox notifications | kernel notification rail (ADR0006) | installation configuration | configured; acknowledged delivery open (R06) |
| Outbound | kubectl / AWS / GCP / Azure CLIs | Command helper (ADR0039): coached argv, copy, run in the person's own terminal or OSHAL Node, record the result | person's own signed-in CLI profile; the application executes nothing | implemented as coaching + records; in-application execution needs kernel rails (KERNEL-RAILS-NEEDED.md) |
| Outbound | Canonical ticket | package ticket port (`createTicket`, `getTicket`) and `POST /tickets/{id}/approve` | caller / approver tier | implemented |

What is not aligned yet, and why: a Studio-authored node that executes the approved script would
need an executable node type with a capability binding in the kernel's process-definition engine
and a package port for artifacts; neither exists, and adding them is core work (Rule 0d: core is
load-bearing). Until then the response stage is a package stage after the gate, shown beside the
Incident work view rather than inside the Studio canvas.
