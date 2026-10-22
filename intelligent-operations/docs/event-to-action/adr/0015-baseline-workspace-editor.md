# ADR 0015: The workspace editor belongs to the kernel baseline

Status: Implemented in the native Kubernetes installer; acceptance is recorded separately.

## Decision and reason

Code Server is installed with the kernel, before loading public applications. This
restores the existing OSHAL Helm baseline instead of making each application install
its own editor. Workflow Studio generates and accepts artifacts; the kernel projects
those exact bytes to the standard shared `oshal-workspace` PVC. The editor mounts that
same claim and the portal resolves the admitted ticket workspace.

The installer waits for administrator bootstrap, kernel readiness and editor readiness
before recording a successful baseline. Existing installations have an explicit editor
upgrade that preserves accounts, applications, workers and workspace data. Normal
forwarding manages both local browser ports and reconnects after pod replacement.

## Access boundary

This is the existing local operator workspace model. The editor has read/write access
to the entire share, with no kernel credentials, provider-account volumes or Kubernetes
service-account token. The listener binds to pod loopback; the operator reaches it
through loopback Kubernetes port-forward. Exec probes check the loopback listener.
An ingress-deny policy adds protection where supported, but the local kind CNI does not
enforce NetworkPolicy; the loopback listener is essential. Public or multi-user remote
editor sessions require a separate authenticated, scoped gateway and are not delivered
by this decision. Portal artifact downloads continue to enforce current caller access.

## Acceptance

Verify a fresh baseline with no application loading, administrator password login,
removed bootstrap password Secret, ready kernel/editor and bound workspace PVC. Upgrade
the existing installation and open a workflow-generated report through its portal link;
compare its bytes in the kernel and editor containers. Verify that the loopback health
endpoint works and direct pod-IP editor access fails. Source regressions pin ordering,
isolation, port validation and preservation during upgrade.

Kernel commands and receipts: `deploy/k8s/LOCAL-INSTALL.md` and
`deploy/k8s/editor-evidence.json`. This does not establish generated remediation,
approved infrastructure execution or full platform certification.
