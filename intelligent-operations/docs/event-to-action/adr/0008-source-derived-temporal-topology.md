# ADR 0008: Reuse the reviewed topology structure with temporal identity

Status: Accepted design, 20 October 2026. Bounded implementation and native lab acceptance
are recorded in ADR0009 and the topology receipt; scheduled discovery and full P4 remain open.
Basis: the operator explicitly directed review of the archived correlation database and load scripts.
Extends ADR0002, ADR0004 and ADR0007.

Decision: Use the host/service, AWS network and Kubernetes topology loaders as the initial entity
and relationship model. The source trace and normalized relationship directions are recorded in
[GRAPH-STRUCTURE.md](../GRAPH-STRUCTURE.md). Retain collection batching, source provenance,
full-scan generations and explicit typed relationships. Keep the new application vocabulary neutral.

Use native resource identities scoped to their authorized account/project/cluster. Names and IP
addresses are aliases, not identity. Preserve actual Kubernetes owner-reference chains. Maintain
observation and validity times for nodes and edges so correlation reads the topology relevant to
the event. A completed, scoped generation may retire missing observations; partial or failed scans
may not. Stamp freshness only on records actually observed in that scan.

Separate containment, ownership, placement, routing and evidenced dependency relationships.
Correlation traverses an explicit versioned direction/type policy with budgets. Sharing a region,
datacenter or broad network hub does not alone establish a common incident.

Alternatives rejected: rebuilding the domain structure without reviewing the existing loaders;
copying their estate-specific configuration; using pod names as instance keys; deleting graph
relationships before a partial reload; stamping every old record fresh after one scan; treating
all historical links as causal dependency or choosing the database engine from a document title.

The application owns the normalized graph contract and correlation policy. The kernel owns
identity, scheduler activation, caller-bound connections and authorized execution. Database engine
and hardware compatibility remain implementation validation, not implicit approval of an archived
image or deployment.

Acceptance: provider/account collision, same-name pod replacement, real owner chains, namespace
selector matching, autoscaling and movement, partial/failed scan preservation, interrupted generation
replay, stale edges, direction, cycles, shared hubs, event-time topology and traversal limits. These
remain M3/P4 acceptance gates and must be evidenced through the installed experience.
