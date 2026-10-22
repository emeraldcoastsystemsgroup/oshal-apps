# ADR 0020: Three rolling context banks and durable evidence

Status: Accepted native profile, bounded growth and real-time minimum-age/packet-survival canary.
Date: 21 October 2026.

The operator recalls a three-database rotation strategy that preserved extended data
while alerts passed through filtering. Alerts alone omit the context an investigation
needs; wholesale rotation can erase it while a ticket is still processing.

Use three logical, caller-scoped telemetry banks in the standard application store,
with explicit resource mappings and configurable byte/record bounds. Rotate on capacity;
never reuse a bank whose newest accepted receipt is younger than 900 seconds. Transactional
backpressure is preferable to acknowledging a batch that silently destroys protected
context. A 3×5-minute schedule alone fails the minimum-age requirement.

Keep telemetry, the alert ledger and pinned evidence separate. A durable matched capture
reservation authorizes a bounded context projection for its exact resource. Copy that
projection and provenance into an immutable packet before releasing the bank lock.
Packet retention is independent of raw rotation and does not confer execution authority.
The first native profile uses three SQL collections rather than three database servers;
it reuses platform scope and atomic checked commits instead of introducing a privileged
database-management plane. Bounded safe bank growth and reviewed ceiling increases preserve existing rows. The
byte/record ceiling remains a backpressure boundary. Physical storage autoscaling
requires measured profiles and remains open.

Accept a bounded OTLP JSON log/numeric metric profile and decoded CloudWatch subscription
batches through existing caller authorization. Require native ID/scope mappings and
CloudWatch account/group/stream bindings. Use standard collectors to receive syslog/file
logs and decode provider transport. Never infer a machine identity from a display name.

Provide separately labeled recorded research samples and deterministic synthetic scenario
controls. Exercise actual percolation, reduction and graph paths; retain raw provenance,
licensing notices and original timestamp ties. A synthetic cohort is a regression and
demo, not evidence of detector accuracy on real datacenters.

Required verification: concurrent writers/retries, changed event ID conflict, whole-batch
rollback, 900-second reuse boundary, forced owner policies, exact resource windows,
pinned evidence surviving rotation, actual engine replay, browser refusal clearing and
native migration/role admission. Source rollback uses a new revert commit. Existing
telemetry/PVC data is retained; reverting source must not drop its tables or packets.

Native verification on 21 October accepted actual 909.788-second reuse, stable pinned
packet hashes after reclamation, reviewed bank growth and a pinned standard Collector
export. Saved replay cohorts reuse the existing owner-scoped application store: only
immutable decision/correlation references are accepted, and the server reconstructs
counts and the exact graph revision. Reopening a cohort does not replay deliveries or
confer new capture/execution authority. This is a durable demo/audit view, not a new
unattended workflow or a live-health assertion.
