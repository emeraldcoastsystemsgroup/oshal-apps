# TriageNorth feature catalog

Updated 23 October 2026. This file tracks every feature of the Operations application
(TriageNorth) for the competition: what each one does, where it is in the product, and how far it
is proven. Requirement numbers (R01–R29) refer to the [delivery audit](DELIVERY-AUDIT.md).
Evidence paths are under `deploy/evidence/`.

Each feature has one of three statuses:

- **Live.** Accepted on the installed lab (kind cluster `operations-lab`, portal
  http://127.0.0.1:38081) with a recorded receipt or screenshot.
- **Guarded.** Built and covered by automated tests. Live acceptance waits on the input named in
  the row.
- **Partial.** Part of the requirement works; the gap is named.

Tests: the Operations suite passes 215 of 215 (`node --test "tests/*.test.cjs"`), and the store
gate passes on every merge. Each kernel change ships with its own guard test.

## From an alert to a verified recovery

| Feature | What it does | Where | Status | Evidence |
|---|---|---|---|---|
| Unattended alert intake | Alertmanager delivers with a producer token through the kernel producer door, with nobody signed in. | Sources | Live (R07) | `e2e-live.json`, ADR0050, kernel ADR-197 |
| Validated, deduplicated intake | Each alert is checked, stored raw, deduplicated by source, type and resource, or quarantined when invalid. | Data pipeline | Live (R08) | `intake.json` |
| Percolation rules | Stored queries decide which alerts become symptoms and show the reason for each decision. Rules are trialled against recorded events before they go live. | Data pipeline → Rules | Live (R10, R11) | `detection.json`, `policy-workbench.json` |
| Anomaly detection | A local robust z-score and seasonal detector watch your metric streams and raise candidates. | Live context | Live (R25) | `anomaly-live.json`, `anomaly-nab.json` |
| Retained context | Logs and metrics are kept per resource in 15-minute windows and attached to evidence. | Live context | Partial (R09) | `retention.json`, `standard-stream.json` |
| Automatic evidence capture | A bounded evidence packet is captured for each admitted symptom. | Data pipeline | Live (R17) | `scheduled-capture.json` |
| Temporal correlation | Firing alerts are grouped over the recorded topology at the time they fired. | Data pipeline → Correlation | Live (R14) | `temporal-correlation-live.json`, `incident-correlation-live.json` |
| Automatic investigations | The processing schedule starts the canonical investigation (investigate → review → revise) by itself. | Incident work | Live (R20) | `auto-investigate-live.json` |
| Optional Splunk evidence | A bounded Splunk export read sits beside the sealed packet. | Connections | Partial (R18) | `external-evidence-live.json`, ADR0052 |
| Generated response files | The accepted answer yields `remediate.sh`, `verify.sh`, `rollback.md` and `verify.md`, stored byte-exact with digests. | Incident work | Live (R21) | `response.json` |
| Approval bound to exact work | An approval binds you, the file digests, the target pod and the ticket revision, and expires after 30 minutes. | Incident work | Live (R22) | `response.json`, ADR0037 |
| Plans from accepted work | Response plans are built from the kernel's accepted work, not from text the browser sends. | Incident work | Guarded | ADR0055 |
| One dispatch, verified recovery | One confirmed exec per approval. Recovery counts only with a passing `verify.sh` plus a resolved alert. | Incident work | Live (R23, R27) | `e2e-live.json`: alert to verified recovery in 283 s |
| Refused dispatch, nothing ran | When the kernel refuses an action (for example an expired connection), the page says nothing ran, withdraws the approval and offers Approve again. | Incident work | Live | Kernel answer confirmed on the lab at 15:00; `tests/execution.test.cjs` |
| Incident trace | One page follows a ticket from alert to decision, packet, plan, execution and recovery. | Incident work → Trace | Live | `incident-trace-live.json`, `incident-trace-exact-live.json`, ADR0051, ADR0053 |

## Seeing the estate

| Feature | What it does | Where | Status | Evidence |
|---|---|---|---|---|
| Systems tree | Cluster, namespace, workload, pod and container, each with captured health and related alerts. | Systems | Live (R13) | `topology.json`, `systems-node.png` |
| Live cluster read | Nodes, pods and deployments read now through your own connection, then saved as a scan. | Systems → Live cluster | Live (R15) | `live-cluster.json` |
| Scheduled discovery | The processing schedule reads the cluster by itself and keeps Systems current. | Systems → Keep this cluster current | Live (R15) | `scheduled-discovery.json`, ADR0049 |
| Cloud clusters | Amazon EKS, Google GKE and Azure AKS clusters and node pools (region, version, node count, machine types, autoscaling), plus Azure virtual machines and networks with subnets. Saved as inventory. | Systems → Cloud clusters | Guarded (R16): live needs your AWS key and the Google Cloud and Azure sign-ins | `tests/cloud-inventory.test.cjs`, `cloud-clusters.png`, ADR0054 |
| 3D topology | An interactive graph at any point in time, with preset queries. | Topology | Live, with synthetic estate data | `graph-experience.json` |
| Scenario lab | A datacenter failure replayed through the real pipeline: 100 occurrences become 40 matches, 4 symptoms and 2 groups. | Scenario lab | Live | `replay.json` |
| RCA library and runbooks | Past analyses with lineage, plus your own runbook per alert type, attached to investigations. | RCA library | Live | `tests/runbooks.test.cjs` |

## Working the problem

| Feature | What it does | Where | Status | Evidence |
|---|---|---|---|---|
| Ops console | Ask in plain words or type kubectl. Each command shows in the terminal, runs through your own connection, prints as a kubectl table, and is assessed (computed verdict) and explained by the analyst. Exec runs only on your click. A live cluster tree with health sits beside it. "Largest cluster" ranks across clouds. | Console | Live | `console-live.json` (11 s, healthy, 60 cores and 365.1 GiB), `console-live.png` |
| Pod console | Current status, recent logs and reviewed in-pod commands for one pod. | Systems → pod | Live | `pod-workbench.json`, POD-CONSOLE.md |
| Cloud and SSH commands | Coached aws, gcloud and az reads run through your own cloud connection; host commands run through your own SSH key. | Cloud & SSH commands | Live for SSH; cloud reads wait on keys | `ssh-host-command.json`, kernel ADR-195 |
| Jarvis tools | "What needs my attention in operations?" is answered from your own records, with the page to open. | Jarvis | Live | `jarvis-tools.json`, `jarvis-operations.json` |
| Swarm hand-off | Send a response plan to the swarm that owns an environment, and file work other swarms send you. | Swarm hand-off | Live for receiving (a delegation was filed as an investigation); sending waits on a peer installation | `swarm-hand-off.json`, ADR0043, kernel ADR-194 |

## Git, GitOps and provisioning

| Feature | What it does | Where | Status | Evidence |
|---|---|---|---|---|
| Git explorer | A compact repository list, a folder tree and a file viewer (rendered markdown, numbered code with YAML key colouring), with tabs for pull requests, pipelines, branches and the cluster link. | Git explorer | Live for GitHub: 22 repositories, files read | `git-live.json`, `git-explorer-compact.png`, ADR0048 |
| GitLab browsing | The same explorer for GitLab projects. | Git explorer → Provider | Guarded; the operator uses GitHub | `tests/git-explorer.test.cjs`, kernel PR 100 |
| Promote through Git | Commit plan files or manifests to a branch, open a pull request and start the pipeline. | Incident work, Provisioning | Live: [pull request #1](https://github.com/emeraldcoastsystemsgroup/triagenorth-provisioning-demo/pull/1) opened | `git-live.json`, `git-promotion-live.png` |
| Provisioning through Git | Render a team namespace or app (quota, limits, default-deny, editors) as exact YAML, then promote it. | Provisioning | Live; API server dry run accepted | `provisioning-dry-run.json`, `provisioning-live.json`, ADR0044 |
| Ticket synchronization | Workflow steps linked to Jira, GitHub and GitLab issue state. | Incident work | Partial (R24) | `jira-readonly.json` |

## Experience and safety

| Feature | What it does | Status | Evidence |
|---|---|---|---|
| Glass look | The platform glass layer on every page; trading-app density (13px tables, uppercase labels, aligned numbers, status pills); follows the person's theme. | Live | `console-live.png`, `git-explorer-compact.png` |
| Narrow screens | On phones and the cockpit side pane, the page menu is one sticky row you swipe sideways. | Live; checked in the operator's pane | `narrow-layout.png` (preview with sample data) |
| Sign-in returns you | After signing in from a refused screen you land back on that screen, or on the app inside the cockpit. | Live | kernel PR 97 |
| Token safeguards | The GitHub token field is always visible and checked with GitHub at once. A token from the wrong service is refused before saving. | Live | `tests/git-explorer.test.cjs` |
| Readable repository files | The kernel no longer masks file content as if it were a secret. Real credentials inside a file stay masked. | Live | kernel PR 102 |
| Your own authority | Every read and action runs under the signed-in person's own connection, with a fresh confirmation for each. Nothing runs automatically without an approval bound to exact work. | Live | ADR0037, `installed-acceptance.json` |

## Kernel contributions made for this application

These changes to the OSHAL kernel were made for Operations. Each one is merged and has its own
guard test.

| PR | Change |
|---|---|
| 84 | SSH command rail under the person's own key (ADR-195). |
| 85, 86 | GitHub explorer reads, and the User-Agent GitHub requires. |
| 87–92 | TLS for the Kubernetes transport; `connector.read` for applications; the producer door (ADR-197); schedule work that outlives its tick (ADR-198). |
| 97 | A refused screen's "Sign in" returns to that screen. |
| 100 | GitLab browse reads (user, branches, tree, blob, merge requests, pipelines). |
| 102 | A base64 text file body is decoded before the scrubber (files had been unreadable). |
| 104 | Azure virtual machine and virtual network reads. |

## Waiting on inputs

| Item | Needs |
|---|---|
| Live cloud inventory | Your AWS access key in Connections; a Google Cloud and an Azure OAuth client registered for the lab, then your sign-ins. |
| AWS EC2/VPC and Google Compute inventory | Your approval to add an XML parser to the kernel core (EC2 answers in XML), and a Google Compute connector. |
| Pipeline run on the promotion pull request | GitHub Actions billing or spending limit on the account. |
| Second public installation | A public HTTPS address. |
| Test lab runner | Your decision (recommended: leave it as it is). |
