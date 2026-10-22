# ADR 0007: Durable processing before enrichment; anomaly detection is separate

Status: Accepted design, 20 October 2026; services pending implementation.
Extends ADR0002 after review of the archived processing source and operational notes.

Decision: Preserve the established order: authenticated named source → durable raw delivery and
separate telemetry → versioned mapping/identity → stored-query and window evaluation → scoped
symptom reduction/reservation → bounded temporal correlation → conditional evidence packet →
canonical ticket workflow → standard connector delivery and reconciliation. Repeated occurrences
update counts before any new capture or model invocation is admitted.

A separate anomaly service learns from bounded telemetry histories. Its output is an alert candidate
containing detector identity/version, resource identity, window, baseline, score, confidence and
readiness. That candidate enters the same filtering/reduction path as a source alert. Cold, stale,
missing or failed detectors are explicit states, never normal health. Retain externally supplied
anomaly results without claiming that importing or rescoring them provides local detection.

Use native OSHAL identity, current-caller authorization, connection grants and canonical tickets.
Application-owned services must not invent parallel users or bypass shared connector operations.
Do not launch arbitrary functions or a separate function platform for inbound adapters. Keep raw
deliveries, normalized alerts, telemetry, decisions, reservations/outbox and evidence references
as distinct durable records, with retention and per-source quotas.

Atomic admission/reservation must survive replicas and restart. A process-local cache is an
optimization only. A delivery with uncertain external outcome stays pending reconciliation rather
than being marked failed and blindly retried. Rule/backend failure is distinct from no match.
Use compound cursors plus bounded overlap and idempotent writes for late/tied telemetry results.

Correlation uses parameterized queries over scoped immutable asset IDs and time-valid edges.
Bound depth, visited nodes/edges, elapsed time and output. Record direction and relationship
policy. A failure may use a documented field-grouping fallback, clearly marked degraded.

The evidence collector has narrowly granted read access. The investigation worker receives only
the redacted packet and earlier phase outputs, without kubeconfig, source credentials or general
cluster tools. Script proposals and human acceptance of the report do not authorize execution.
Execution remains a separate registered action with exact artifact/target/current-authority checks.

Alternatives rejected: deduplication only at the ticket sender; inferred source routing; unbounded
graph joins; treating threshold alerts as anomaly detection; treating collection failure as healthy;
memory-only reservations; silently advancing past failed records; silent automatic resend.

Consequences: the hackathon has explicit failure paths and fewer claims of completeness. Service
dependencies and all acceptance cases are tracked in PIPELINE-REVIEW.md and PROJECT-PLAN.md.
Backend selection/pinning and detector calibration remain implementation work, not implicit approval
of any archived infrastructure or credentials.
