# ADR 0013: Inspectable graph and processing cohorts

Status: Implemented and verified in the local Kubernetes experience; receipt in `deploy/evidence/detection.json`.

The experience must explain what survived filtering, deduplication and correlation.
Counters without shared provenance or raw JSON alone do not provide that explanation.

The Graph explorer loads the caller's reconstructed inventory and presents searchable,
typed, keyboard-accessible nodes. Selecting a node opens its directed relationships,
health observation, native identity, scope and source evidence. The overview renders at
most 100 matching nodes and states the truncation; source reconstruction budgets remain
unchanged. Missing nodes are not inferred to be deleted after partial collection.

The processing flow uses one latest returned decision per delivery. Its incoming cohort,
percolator matches and new/escalated symptoms share that denominator. It displays both
fractions and counts, with event drill-downs and separate unmatched/suppressed states.
These are latest returned pages, not installation totals or a live throughput claim.
Policy replay does not increase a delivery count. Correlation coverage is shown separately
because analyses can overlap and cannot safely be added together.

An explicit user action evaluates selected events using their active source policy,
then correlates only the admitted/escalated survivors. Each existing service retains its
own durable transaction; failed evaluations remain visible and retryable. No automatic
collector or infrastructure action follows. Saved correlation analyses come from the
existing owner-scoped decision journal, survive reload, and show groups, input events,
paths, graph revision, time and limitations. Degraded exact-asset fallback is labeled as
such, never as proven dependency correlation.

The graph and flow reuse existing source, policy, SQL, OpenSearch, original-caller and
native engine contracts. They introduce no separate database, ingestion runtime or
credential store. Continuous processing, separate OTLP observations, anomaly detection,
conditional evidence consumers, execution and external synchronization remain open.

Native acceptance also exercises shared framework dependencies: cockpit tool URLs must
place query parameters before application fragments, and SQL mutations must load foreign-key
dependencies of earlier transaction reads before validating the whole snapshot. Neither fix
weakens caller admission or referential integrity. The pinned local OpenSearch image is
verified by content ID before Kind import aliases are repaired on each node.
