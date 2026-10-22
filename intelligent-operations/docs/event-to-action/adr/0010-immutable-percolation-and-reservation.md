# ADR 0010: Publish immutable rules before transactional symptom reduction

Status: Implemented in source; installed acceptance is recorded separately in IMPLEMENTATION-STATUS.md.
Extends ADR0002, ADR0007 and ADR0009. Owner: Operations package; P2/P3/M4.

Use an actual OpenSearch percolator behind the existing kernel `engine.exchange` relay. The
operator pins the package engine endpoint. The package derives its owner scope from the current
verified user, checks the engine build digest, and exposes only health, publish and match commands.
The engine has no Kubernetes credentials or command execution interface. General HTTP egress
exceptions and another kernel adapter are unnecessary.

Publish 1–128 bounded stored queries into an immutable owner/policy index, validate every write
and count, then seal the index before activating its SQL source binding with a revision check.
Matching exhausts all result pages with an exact count. Timeouts, partial shards, missing indexes,
build mismatch and transport failures are failed attempts; they never mean an unmatched event.
An unsuccessful activation can leave an unused immutable index; cleanup/retention remains required.

Within one caller-scoped transaction, record the rule decision, symptom occurrence, current count,
processing state and evidence-work reservation. Identity includes policy family and the validated
source/environment/resource-kind/scope/native-ID/alert-type tuple. The source tuple remains distinct
from graph-based incident membership. Replaying the same delivery under another revision of that
policy family does not count it twice or create another reservation. Renaming the policy creates a
new family and must be a deliberate operator choice.

Window mode is explicitly fixed or sliding, from 1 to 86400 seconds. New episodes and a rise above
an episode's highest severity reserve evidence work before expensive collection or investigation.
Event time prevents late and same-time conflicting states from overwriting the latest source state.
Receipt time controls the suppression window. A resolved source event can update its existing
symptom even when firing-only rules do not match; it does not attest recovery or close a ticket.
A reservation records whether its matched rules request a snapshot, and never authorizes execution.

Reject copying process-local reservations, partial persistent keys, successful-looking backend
fallbacks, first-page-only matches, or suppression after model investigation from the archive.
Retain its scoped key/window/reserve-before-dispatch process with durable transaction semantics.

Acceptance uses real PostgreSQL, two independent SQL pools, real OpenSearch and the shipped browser
assets: pagination, disabled rules, rejected publication, revision races, 100 occurrences/one
reservation, replay, owner isolation, window boundaries, escalation, late resolution, rollback and
lost commit acknowledgement. Named protocol fault seams separately test timeout/partial-page
refusal. Installed native SQL and relay behavior require their own Kubernetes receipt.

This increment is operator-triggered evaluation of recorded normalized alerts. Durable OTLP
telemetry, time-window aggregation, anomaly detection, background queue consumption, evidence
reservation consumers and ticket dispatch remain separate delivery gates.
