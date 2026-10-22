# ADR 0009: Implement the bounded temporal graph on native scoped SQL

Status: Accepted implementation decision, 20 October 2026. Extends ADR0008.

Use the kernel's existing caller-scoped transactional SQL service for immutable inventory scan
records and saved correlation decisions. Reconstruct the selected observation time in application
code with explicit directed relationships. This provides the reviewed domain structure without
adding an archived graph database image or a separate identity service to the installation.

Each collection belongs to a named source. Provider, native account/project/cluster scope, kind
and native resource ID determine an asset identity. A complete scan replaces that collection's
current observations; partial scans preserve previously observed facts with their original timestamps.
Immutable generations preserve history and permit late delivery. A repeated scan ID with different
content or two distinct scans at the same collection timestamp is refused. Retries are transactional.

Correlation joins only affected assets connected by an explicitly allowed directed dependency path.
An unaffected common hub does not merge its dependents. Partial collections, missing/stale assets,
unavailable relevant relationships and exhausted traversal budgets produce a visible degraded
result with exact-asset grouping only. Decisions record the policy, selected deliveries, graph revision,
scan IDs and paths. Saving a decision does not dispatch a ticket or authorize execution.

This first implementation admits 256 assets and 512 edges in a 64 KiB scan, reconstructs at most
200 scans / 2,000 assets / 5,000 edges, and bounds traversal depth and visits. Exceeding a bound
fails explicitly. It does not silently truncate a graph or certify an incomplete result. Production
retention/checkpointing and a larger graph backend remain open; the common contract isolates that
later choice. A collection that exceeds a bound must be narrowed before capture.

The initial loader is an operator-run, guarded Kubernetes lab capture. It reads actual native UIDs,
ownerReferences, container runtime IDs and EndpointSlice targets, excluding arbitrary pod fields.
It is not a periodic scanner or a worker with general cluster access. AWS/Azure/GCP discovery,
source conflict resolution, scheduled collection under service grants, automatic suppression
integration and original-event-time policy selection remain subsequent work.

Validation: real PostgreSQL transaction/isolation/browser contracts plus installed native API
acceptance. PostgreSQL results alone do not establish native deployment acceptance.
