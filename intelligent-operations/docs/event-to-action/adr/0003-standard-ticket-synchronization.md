# ADR 0003: External ticket synchronization uses standard connectors

Status: Accepted design,20 October2026. ADR0025 implements a manual outbound handoff in source; unattended bidirectional synchronization remains open.

Context: Inbound monitoring integrations and outbound ITSM/developer-ticket integrations serve different
purposes. Teams need linked ServiceNow incidents, GitHub/GitLab issues and Jira issues while retaining
one canonical OSHAL ticket. All use the signed-in user's standard connection authority.

Decision: Configure inbound alert sources separately from outbound and optional bidirectional ticket
sync. Reuse the standard connector catalog, per-user/named-account selection, shared-connection
grants, secret references, confirmed write boundary, webhook verification and audit. Implement missing
operations in that framework rather than direct app HTTP clients or a second credential system.

A durable link identifies tenant/principal scope, canonical ticket, provider, connection/account,
external record and revisions. Policy owns field direction, status mapping, comment handling and
conflict resolution. Track origin markers and revisions to suppress echoes. A durable operation ledger
reserves stable operation identity before writes. Reconcile unknown creates before retrying; if a
provider cannot prove the outcome, retain a blocked/manual-review state rather than claiming exactly once.
Remote ticket closure is not verified infrastructure recovery. Permission loss pauses synchronization.

Source review: oshal-kernel/connectors contains all four declarations. ServiceNow currently declares GET
resources only; GitHub declares confirmed create/comment actions and issue webhooks; GitLab/Jira
resource declarations do not establish complete guarded bidirectional status sync. The actual native
write signature takes a confirmed context in crates/connectors/src/actions.rs. Provider completeness,
webhook verification and installed admission must be tested per operation, not inferred from ADR prose.

Alternatives rejected: app-owned credentials, blind POST retries, duplicate local ticket engines,
last-write-wins status overwrite, feedback loops and automatic incident recovery from remote closure.

Acceptance: One canonical link, correct caller/account and target, denied write, expired/revoked
connection, lost response after create, duplicate/reordered webhook, conflict, status mapping, echo
suppression and comment redaction. Use disposable provider targets; never create real tickets as part
of mockup review or local repository tests.

The first manual implementation is documented in [ADR0025](0025-manual-workflow-ticket-handoff.md). It reserves a current canonical snapshot before confirmed native Actions and labels durable outcomes as operator reports. It does not complete the broader synchronization acceptance above.
