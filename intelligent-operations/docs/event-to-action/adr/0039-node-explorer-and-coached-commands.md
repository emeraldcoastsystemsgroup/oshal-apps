# ADR0039: Node-level Kubernetes explorer and coached commands under the operator's own authority

Status: implemented in source, 22 October 2026; guards pass. Extends ADR0019, ADR0032 and ADR0034.

**Nodes are first-class in Systems.** The scan normalizer records each node's capacity and
allocatable (CPU, memory, pods), its conditions with any pressure flagged, cordon state, roles,
taints, internal IP and hostname, kubelet, OS, container runtime, architecture and kernel, as
bounded scalar facts. The detail pane shows a capacity table, the pressure and cordon warnings,
the version facts and the pods placed on the node from recorded placement edges; each pod is a
link that expands the tree to the exact pod. Absent facts are omitted, never fabricated, and the
pane says the facts are saved observations, not a live read.

**Coached commands run under the person's own authorization.** The Command helper page asks the
operations analyst for one reviewable command from a `cli-helper-v1` packet: tool, goal, optional
context (treated as data) and the recorded target. The reply is an argv array with reason,
read-only flag, risk and verification; prose without a valid argv stages nothing, and a proposal
that looks like it contains a credential is discarded. Two execution paths exist, and the page
says which applies:
- `pod-exec`: the reviewed command runs once through the person's own Kubernetes connection with
  a fresh native confirmation (ADR0034), and the native result is recorded.
- `kubectl`, `aws`, `gcloud`, `az`: the person copies the command and runs it in their own
  terminal or OSHAL Node under their signed-in profile, then records the pasted result. The
  record is labelled operator-provided; the application executed nothing and holds no cloud
  credential.

Records are closed, bounded (16 KiB output, 200 per person) and own-scope.

**What the kernel would need for in-application cloud execution.** There is no rail today for a
page or package to run `aws`, `gcloud`, `az` or `kubectl` under the person's credentials: the
cloud connector catalog has no executable AWS signing (SigV4), no Azure management connector,
no SSH or host-shell connector, and the native node cannot receive shell tasks. Those are listed
in [KERNEL-RAILS-NEEDED.md](../KERNEL-RAILS-NEEDED.md); this application will adopt a rail the
day it exists without changing its review-first flow.

Alternatives rejected: a package-held kubeconfig or cloud profile; running commands through the
analysis bot; presenting pasted output as verified; hiding nodes behind pod placement only.
