# Pod investigation console

Implemented operator path, 21 October 2026. The owned local cluster has accepted
current status, a bounded command and namespace RBAC refusals through the shared
service. Installed browser inspection and exact command review/execution also pass.
Runtime receipts identify the checked application and kernel sources; full kernel
release certification remains separate.

Open Systems, expand the workload ownership tree and select a pod. The detail pane
retains its captured facts and offers the pod console. Choose your own Kubernetes
account, read current status and select the returned container. Read recent logs,
choose a named diagnostic task (identity, disk, container memory, CPU counters, processes or network),
review its exact arguments and execute the reviewed command. Custom arguments
remain available under Advanced. Editing the
arguments or container invalidates the review. A second execution requires a new
review. Kubernetes API exec supplies this container connection; SSH is for a
separately configured host connection.

The shared kernel owns cluster TLS, credential storage, connection admission,
namespace restrictions, confirmations and transport. Operations owns the resource
selection, review and analysis experience. No host kubeconfig or administrator
credential fallback exists. An unconfigured service tells the operator to connect
instead of showing a working terminal. Every native action is freshly confirmed
under the original signed-in account. The package does not grant infrastructure
capabilities to its evidence-only analysis bots.

Ask operations analyst sends the selected normalized status and bounded output to
the existing named bot conversation rail, with ordinary bot identity and usage
accounting. The operator's question is limited to 4,000 characters; output admitted
to that question is limited to 12,000 stdout and 4,000 stderr UTF-8 bytes, reduced
further when necessary to fit the analysis-packet budget. Large optional status or
argument fields are omitted with explicit markers. The request omits general application-summary context. Only the selected container status is included; unrelated fields and general
application summaries are omitted. No other pod, graph or connection secret is attached. The displayed current status and output are readable without opening raw JSON.
Advanced transport receipts retain the exact native answer. Evidence sent to analyst
shows the versioned preprocessed packet, selected container, requested command,
receipt metadata, and explicit output inclusion/truncation counts. A valid structured suggestion can be staged with Use suggested command; it still
requires exact target/argument review and an explicit execution. Other suggestions
remain text. Asking for analysis never runs commands.

The initial console uses one bounded command at a time, without stdin/TTY. It is
not a persistent interactive shell. A transport timeout, disconnect or missing
exit receipt is an unknown remote outcome, requiring reconciliation before retry.
Pod identity is checked before and after; the API's name-addressed exec has no
atomic UID precondition, so these checks do not eliminate the replacement race.
A completed command does not establish incident recovery.

Historical RCA reports remain in canonical ticket work and workspace artifacts;
[RCA library](RCA-LIBRARY.md) is their read-only index. Automatic historical-case
retrieval into new sealed investigation inputs remains a separately scoped backlog
item. The temporal correlation graph is not a second report store.

Container memory and CPU tasks read cgroup v2 counters inside the selected container.
Memory returns usage and limit bytes in argument order; `max` means no configured
limit. CPU counters are cumulative and do not supply a utilization percentage on
one read. Missing cgroup files or tools produce a real failed command, not a zero
measurement. These tasks do not read node-wide `/proc/meminfo` as pod usage.

## Expiring connections

A Kubernetes TokenRequest credential has a provider deadline. The standard connection
framework now records an optional expiry when saving a manual credential; Connections
shows its expiring or expired state and the native action boundary refuses expired
credentials. This does not probe provider validity or automatically renew a token.

For the existing installer-owned namespace account, renew with the kernel installer
`python3 deploy/k8s/install.py pod-connect --pod-namespace operations-demo`. Run it
from the kernel repository and sign in as the same portal user when prompted. The
command verifies the existing namespace Role and binding, requests a one-hour token,
saves the real issuer expiry and closes its temporary session. It does not widen the
namespace authority or use the cluster administrator credential in the portal.

When supplying another provider credential through Connections, set its actual
expiration time in the local-time field. Leaving it empty means the expiry is unknown,
not that the provider credential never expires. Existing saved records are not silently
rewritten. Reopen the selected pod after renewal and read current status before
requesting logs or reviewing a command.
