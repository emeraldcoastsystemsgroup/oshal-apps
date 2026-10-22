# ADR 0011: Restore the standard shared workspace installation

Status: Standard installation restored (`a3de02d`, `18b68cd`); artifact/approval implementation published (`aac99fb`). Installed experience acceptance is tracked in IMPLEMENTATION-STATUS.md.
Owner: native installation and workflow runtime. Extends ADR0001 and ADR0005.

The operator requires the existing OSHAL shared workspace, not an Operations-specific
file service. The reference Helm chart already declares `oshal-workspace`, retains it
on Helm uninstall, and mounts it at `/app/workspace-shared` for API and bot pods. The
native Kubernetes installer omitted that contract. Restore the claim and workspace
environment aliases in the standard installation, with a storage-only upgrade that
preserves users, applications, provider settings and existing claim capacity.

Kernel and bot workers use that claim. Each worker stages only its admitted task in
its private node directory; the agent sandbox does not expose the whole share, node
enrollment Secret, provider credentials or Kubernetes credentials. RWO storage requires
co-location on its node. Use RWX storage for workers distributed across nodes. The
retention annotation does not protect a PVC from namespace deletion.

The workflow produces deliverables through its existing executor. The native broker
produces an answer artifact. Named CLI workers already capture actual file changes,
a change manifest and the answer with hashes. Do not parse prose into pretend files,
substitute assistant-written scripts, or present supplied proposal inputs as generated
remediation. Preserve the producing ticket, work, phase, bot and content provenance.

The standard runtime stores accepted output and projects its exact bytes onto the PVC
before advancing the workflow. Downloads retain original-caller access checks. The UI
must distinguish unavailable storage/results from an empty workspace and must not
invent an installed Code Server endpoint. Accepted history remains readable after a
source revision update under current ownership, active application/bot and uncancelled
authority checks; execution still requires the original exact generation.

Approval goes through the native confirmed ticket approval endpoint and displays its
returned state. Approving an investigation/report is not evidence that a remediation
ran. Exact remediation approval, constrained execution and measured recovery remain
separate acceptance gates.
