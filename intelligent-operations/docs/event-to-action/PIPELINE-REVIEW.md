# Pipeline review and delivery gaps

Reviewed 20 October 2026. This is a source review, not certification of the archived deployment.
The existing pipeline's process is retained; its product names, deployment conventions and
function-hosted inbound adapters are not part of this application.

## Coverage and findings

The local archive was inspected for the source adapter contract, event filter, query/configuration
synchronization, document percolation, event stashing, grouping, graph correlation, AI enrichment,
sender reservation, delivery writeback, inventory feeds and anomaly-result processing. Source files
and operational notes disagree in places; the implementation takes precedence for this review.
The anomaly result consumer and score postprocessor were found. Detector provisioning and original
production calibration have not been established, so full anomaly-engine parity is not claimed.

The current coverage table below was reconciled with later intake, detection,
topology and scheduled-processing receipts after runtime shutdown. The owned runtime resumed21October; historical receipts remain dated. Native
OTLP/CloudWatch JSON intake, three protected telemetry banks, pinned packets and a
non-container replay now have separate accepted increments in STREAMS-AND-REPLAY.md. [DELIVERY-AUDIT.md](DELIVERY-AUDIT.md) maps the full
remaining requirements, and [RESOURCE-REVIEW.md](RESOURCE-REVIEW.md) records the restart gate.

| Stage reviewed | Finding | Required treatment |
|---|---|---|
| Collection and source routing | Source names could select convention-derived indexes; specialized source filtering and generic pass-through coexist. | Authenticate a registered source; select its immutable mapping and routing revision from configuration. Missing identity is quarantined, never guessed. Use ordinary long-running adapters and standard envelopes. |
| Percolation | Stored-query synchronization precedes data processing. The reviewed search has no explicit result size/pagination or shard/timeout validation. Errors are caught and processing continues. | Readiness requires published rule revision. Distinguish no match, incomplete search and backend failure. Prove all matches above the default result page; durable retry/dead-letter handling must precede acknowledgement. |
| Grouping | Compound field identity, optional transformations and graph grouping are distinct mechanisms. Missing values and regex-based key normalization can change identity. | Preserve raw identity and version normalization. No title/hostname heuristics. Separate delivery ID, recurring symptom, correlated incident and destination operation keys. |
| Reservation | The newer sender reserves under an in-process lock before sending, remembers success and releases a failed reservation. That lock is not distributed. Its persistent recent-delivery lookup omits target/config dimensions used by the memory key and treats lookup errors as no prior delivery. | Preserve reservation semantics using a durable atomic store across replicas. Scope every lookup consistently. Uncertain delivery requires reconciliation; it is not safe to release and resend blindly. |
| Suppression windows | The older documentation describes a 900-second cache flow; newer source defaults to 86400 seconds and refreshes an existing entry on reservation. | Define and expose configured fixed/sliding semantics. Test boundary timestamps, recurring storms, escalation and resolution. Do not silently select either historical default. |
| Graph correlation | Queries use bounded breadth-first traversal and connected components; directional and nondirectional variants differ. Some templates contain estate-specific assumptions. Failure/empty results fall back to field grouping. | Use scoped immutable asset IDs, event-time edges, explicit direction/relationship policies and node/edge/time budgets. Show degraded fallback separately from verified correlation; shared hubs must not merge unrelated incidents. Parameterize queries. |
| Enrichment | An operational note reports seven groups producing 1,892 enrichment records. Incorrect upstream routing and absent write deduplication were hypotheses in that note, not proven causes. | Reserve the incident revision before snapshot/AI work; retain occurrence counts without multiplying collections. Measure admitted events, groups, captures, model calls and sends independently. |
| Anomalies | One consumer reads external random-cut-forest results using grade/confidence thresholds; a separate processor adjusts existing actual/typical/score results. Neither is the detector itself. | Provision and test an actual detector separately. Store detector/version, entity, window, baseline, score, confidence and readiness. Do not call a fixed Prometheus threshold or a score transformation an anomaly engine. |
| Anomaly cursor | Results are fetched by strictly greater timestamp; no tie-break cursor is used. Failed items are skipped and a later success can advance the watermark beyond them. | Stable compound cursor plus bounded overlap and idempotent ingestion; durable per-item failure handling. Test equal timestamps, late arrivals, restart and partial batches. |
| Writeback and resolution | Provider send and downstream status persistence are separate operations. | Durable outbox with destination-specific idempotency and reconciliation. A resolved source symptom only closes its own occurrence; incident recovery requires policy and observed effect. |

## What is actually available here

| Capability | Current evidence | Remaining implementation |
|---|---|---|
| Named sources and normalization | Caller-owned revisions, validation and raw/normalized views; native transactional ledger, concurrent retries and conflicting-ID quarantine accepted in intake.json. | Background producer authentication and replay lineage; multi-kernel-replica acceptance remains distinct from concurrent HTTP clients. |
| Monitoring | Prometheus/Alertmanager and native detection are resumed; earlier bounded fault capture remains historical. A temporary actual standard Collector exports syslogs and metrics into the native store. | Bounded durable JSON log/gauge/sum storage now exists separately. Continuous delegated collector export and other OTLP signal/encoding profiles remain open. |
| Filtering | Real OpenSearch percolation, immutable rule publication and durable decisions accepted in detection.json; native scheduled queue draining accepted in processing.json. | An exact-resource15-minute context window is implemented; aggregation rules, continuous producer integration and detection-index lifecycle remain open. |
| Noise reduction | Transactional source/type/resource symptom keys, suppression and evidence reservations accepted; 100 occurrences reduced to three admitted symptoms in the recorded cohort. | Downstream reservation consumption, failed/uncertain-work reconciliation and full automatic capture/investigation delivery. |
| Inventory and correlation | Native temporal scan journal and bounded manual graph correlation accepted in topology.json; actual explorer shows assets, typed edges and correlation paths. | Scheduled discovery, cloud scans and automatic post-reduction correlation. Graph display and manual analysis do not prove those services run unattended. |
| Anomaly detection | Archive consumer/scoring review and explicit architecture below. | Detector backend, baseline data, cold-start behavior, calibration and replay/service acceptance. No anomaly detector is deployed. |
| Evidence | Actual pressure alert matched to exact pod UID; short-lived namespace collector; preprocessed hashed packet and review-only scripts. Secret, exec and cross-namespace reads denied. | Native reservation-bound telemetry packet view and post-rotation survival now pass. Full automatic capture following reduction and external evidence connectors remain. |
| Workflow and tickets | Canonical ticket, scoped worker and published Workflow Studio investigate/review/revise/human gate; three actual phases reached report acceptance. Standard worker/shared PVC and baseline editor have later installer evidence. | Automatic incident-to-ticket linkage, workflow-generated remediation, exact execution approval and registered action/recovery verification. |
| External actions | Shared connections and notification configuration exist. | Ticket synchronization outbox/webhooks, actual notification producer and separately authorized execution. |

## Service acceptance matrix

These are the full cross-stage acceptance requirements. Some cases have since passed
in the receipts above; this list alone is not a claim that a case passed or remains
unimplemented. Record completion against the specific source revision and scope:

1. **Intake:** forged source, missing resource ID, same ID/different payload, reordered JSON,
   100 exact retries, independent sources/types, two replicas and crash after commit/before acknowledgement.
2. **Filtering:** no match, more than ten matches, disabled rule, simultaneous rule publication,
   index missing, shard failure and timeout. No failed search may be recorded as an unmatched event.
3. **Reduction:** 100 occurrences produce one admitted capture/investigation for the same incident
   revision, with all counts retained; two concurrent workers and restart produce no duplicate work.
   A destination timeout is reconciled before a second send. Escalation and resolution remain observable.
4. **Correlation:** pod replacement with the same name, cross-account name collision, stale edge,
   unrelated shared-network hub, direction policy, missing graph, cycle and traversal-budget exhaustion.
5. **Anomalies:** baseline warm-up, known injected shift, normal control, seasonal variation,
   flat/zero series, missing/out-of-order samples and high entity cardinality. Report detection latency,
   false positives and confidence; replay ties and failures without loss or duplication.
6. **Evidence/action:** expired collector grant, denied optional source, disappearing pod, truncated
   packet, hostile log instructions, changed artifact/target after approval and failed post-action check.
7. **Pressure demonstration:** measured bounded workload pressure → actual alert → recorded decision
   → isolated packet → canonical workflow → human review → explicit action → matching resolved signal.
   Each arrow needs a durable receipt and an inspectable experience link.

The current lab proves the measured alert and isolation boundaries. It does not yet prove this
entire matrix, production capacity, whole-node saturation or generalized autonomous remediation.

## Source review trace

Review paths are relative to the locally extracted archive; these are historical evidence,
not dependencies to deploy:

- `build/alerting-service/microservices/event-filter/app/stream/routes.py`
- `build/alerting-service/microservices/es-proxy/app/core/operations/search.py`
- `build/alerting-service/microservices/es-proxy/app/stream/main.py`
- `build/alerting-service/microservices/grouper/app/core/functions.py`
- `build/alerting-service/microservices/grouper/app/core/graph_queries.py`
- `build/alerting-service/microservices/sender/app/core/dedup.py`
- `build/anomaly-harmonizer/main.py`

This is a cross-stage functional review, not a line-by-line audit of every archive file or
proof that its historical services ran successfully. The review does not import archived secrets,
credentials, infrastructure configuration or estate-specific identifiers into the new application.
