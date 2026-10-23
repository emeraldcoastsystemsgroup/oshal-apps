# ADR0041: Automatic investigation dispatch and live cluster reads

Status: implemented in source, 22 October 2026. Package guards pass. The two kernel rails it
uses are on `dev/native-parity`: the package ticket-start port (3200d5c) and the Kubernetes list
reads (d033905). Both are installed on the owned lab. Extends ADR0013, ADR0037, ADR0038 and
ADR0039.

Accepted live on the lab on 22 October:

- **Automatic start.** The per-minute schedule captured pending evidence from a real fault and
  started two canonical investigations by itself. Both tickets went to running
  (`deploy/evidence/auto-investigate-live.json`).
- **Schedule suspension.** The first run's schedule was suspended by `deny_tier`. The cause, found
  and confirmed on 23 October, is that replacing the operator's role assignment invalidates the
  schedule activation made under the previous assignment. Replacing it alone, with no release,
  suspended the next tick. After any re-approval the schedule must be re-activated; `lab/reapprove.py`
  now does that, and Overview offers Re-activate. An earlier explanation, a Git commit pin in the
  schedule fingerprint, was fixed in kernel PR 81 for Git registry installs, but staged installs
  like this lab's record a local source, so it was not the cause here.
- **Live cluster.** A headless browser read the lab's 3 nodes, 2 deployments and 4 pods and saved
  them as a complete live scan. The collector's routes were kept
  (`deploy/evidence/live-cluster.json`, `live-cluster.png`).

## Automatic investigation (R20)

Until now a captured evidence packet waited for a person to press Start investigation. The
kernel now gives packages a `ticket_start` port that mirrors the person's own start. It admits a
start only when every one of these holds: the package may run intents, the caller is a writer
with a current session, the input carries only the ticket, executor, prompt, files and limits,
the same app and principal hold an execute or write decision, and the ticket belongs to that
principal, that tenant and a ticket type the package owns.

The processing worker gains an opt-in, "Start an AI investigation automatically", which requires
evidence capture. On each processing tick the package:

1. selects at most two captured evidence records with no investigation or a queued one;
2. seals the input with the existing `prepareInvestigation`, the same packet a manual start uses;
3. moves the record to `starting` before calling the port, so a concurrent tick cannot start it
   twice;
4. records `started` or `already-started`; `start-refused` with the kernel's reason when the port
   refused before dispatch, so nothing started; or `start-uncertain` when the outcome is unknown.
   Neither a refused nor an uncertain start is retried automatically. Each evidence card in Data
   pipeline says which of these happened, so the operator knows whether to press Start.

Without the opt-in, or on a kernel without the port, the tick starts nothing and says so.

## Live cluster reads (R15, Roger's Kubernetes explorer)

The kernel adds three read operations to the Kubernetes connector: `kubernetes-list-nodes`,
`kubernetes-list-pods` and `kubernetes-list-deployments`. They run under the person's own
connection, with a fresh confirmation each. Pods and deployments need a namespace from the
connection's allowed list. Nodes are read through a dedicated ClusterRole that grants only node
get and list. Each read returns at most 500 bounded summaries (identity, placement, readiness,
capacity, versions) and a truncated flag. No secrets, environment values or logs are returned.

Systems gains a Live cluster panel. It offers only the person's own, unshared Kubernetes
connections and shows nodes, deployments and pods as they are now. "Save as inventory scan"
turns the read into a scan:

- **Own collection.** It goes to a separate `live:<cluster>/<namespace>` collection. A complete
  live scan retires only earlier live scans, never the collector's services, ingresses and
  routes. Where both describe the same asset, the newer observation wins.
- **Bounded.** The scan is trimmed to the 64 KiB scan budget. When anything is cut, or a list was
  truncated, the scan is saved as partial with the reason, so it adds and updates but retires
  nothing.
- **Placement.** Pods are linked to nodes only when the node was read in the same call; nothing
  is invented.

## Not claimed

- Scheduled discovery without a person present. Connector actions need a browser confirmation,
  so the save is browser-initiated. A package-callable scheduled read under the person's
  connection is still a kernel rail (KERNEL-RAILS-NEEDED.md).
- Namespaces and multiple clusters per person. The list reads cover one configured cluster and
  its allowed namespaces.
