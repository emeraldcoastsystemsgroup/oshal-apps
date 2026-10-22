# ADR0034: Inspect pods through the shared original-user connector

Implemented, 21 October 2026. Native status/command execution and namespace RBAC
refusals pass on the owned cluster; installed browser inspection and exact command
review/execution also pass. Runtime receipts identify checked sources.

Use Kubernetes API exec for pods. Keep cluster selection, certificate validation,
credential vaults, namespace guards and execution admission in the shared kernel.
The Operations application provides a consistent resource-detail console and exact
command review. AI interprets selected normalized results through the existing
accounted bot rail and receives no cluster credential or execution capability.

Use bounded commands initially. Require fresh confirmation, identify the observed
pod UID and selected container, invalidate review on edits, and represent uncertain
transport outcomes as unknown. Preserve native Kubernetes RBAC alongside the
installation namespace allowlist. Never treat transport closure as proof of remote
termination or report acceptance as recovery.

[POD-CONSOLE.md](../POD-CONSOLE.md) describes current behavior and remaining
persistent terminal and historical retrieval scope. Shared framework rationale and
configuration belong in kernel ADR191 rather than duplicated application services.
