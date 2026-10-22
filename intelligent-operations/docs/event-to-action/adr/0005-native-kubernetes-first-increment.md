# ADR 0005: Deploy the first persistent experience in an isolated native Kubernetes lab

Status: Implemented first increment, 20 October 2026. Extends ADRs 0001, 0002 and 0004 without superseding their target architecture.

Context: The experience must be tested with actual OSHAL sessions, grants, persistence and Kubernetes observations. The existing browser prototype cannot establish those properties. The full source-principal, detection and automation milestones remain larger than this first increment.

Decision: Package the committed Operations application with the existing pinned native OSHAL runtime. Deploy the application and PostgreSQL in an owned local Kubernetes namespace with persistent volumes, native process sandboxing and loopback access. Preserve the shared kernel and existing incident specialists. Use native reader/operator roles and the kernel's person-scoped application store. No separate login, credential broker or ticket engine is introduced.

Authenticate source registration and imports as the current operator. Save immutable mapping revisions and original/normalized alert records with explicit validation outcomes. Save bounded timestamped pod/container captures, preserving unknown readiness and native UIDs. Expose current-caller connection status through the standard framework. The same caller's records must survive pod replacement; another person must not inherit them.

Alternatives rejected: static mockups presented as a deployment; a second identity service; app-owned cloud credentials; unsandboxed execution to bypass nested Kubernetes prerequisites; automatic ingestion or remediation claimed from a manual import test.

Consequences: This is authenticated capture intake, not a background source identity contract. Exact payload retries share one record, but changed payloads, concurrent decision reservation, retained delivery attempts and the established noise algorithm remain M2/M4 work. Captures are historical namespace observations, not continuous discovery or a completed correlation graph. Provider/tool activation remains gated by ADR 0004. The initial runtime used a noop model and did not certify RCA inference. ADR0006 records subsequent model-account activation.

Acceptance: Real native login and experience launch; unassigned/read-only refusal; person isolation; downgrade/revocation; actual source/event/quarantine and inventory forms; desktop and phone layouts; saved records after pod replacement; hash-verified real lab firing/resolved deliveries correlated to exact observed pod UIDs. Deployment and acceptance receipts identify the tested source revision. Production users, grants and default Kubernetes context are unchanged.

Owner boundary: Application UI, records, contracts and isolated deployment harness belong here. Any missing connector, delegated runner or transactional primitive belongs to its shared owner and must be verified before dependent milestones are marked complete.

Installation follow-through, 20 October: the kernel-owned local installer now starts a fresh
kernel and database, sets the existing administrator's first password once, and loads selected
public applications afterwards through the native loader. Initial credentials, desktop profile
and application roles remain native framework concerns. The actual OSHAL Node portal window
passed password sign-in with an isolated Kubernetes profile; existing bare-metal configuration
was preserved. Token import is a separate unfinished shared-runtime contract: the three desktop
vendor import routes returned 404 under an authenticated administrator. No token transfer or
automatic desktop-worker enrollment is claimed. See IMPLEMENTATION-STATUS.md and kernel
`deploy/k8s/local-install-evidence.json` for revision-specific checks.

Subsequent delivery: ADR0006 supersedes the unfinished Codex/Claude import observation above with real installed transfer and model verification. Antigravity and infrastructure-worker acceptance are not implied.
